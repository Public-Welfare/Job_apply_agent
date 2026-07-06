import sys
import asyncio
from datetime import datetime

# Windows consoles default to cp1252, which crashes on Unicode chars (→, •, …)
# printed throughout the crawler. Force UTF-8 on stdout/stderr.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

from rich.console import Console
from rich.table import Table
from rich import box
from src.agent.orchestrator import AgentOrchestrator
from src.services.tracker_service import TrackerService
from src.models import load_profile

console = Console()


async def crawl() -> None:
    profile = load_profile()
    roles = profile.preferences.roles
    locations = profile.preferences.locations

    console.print("\n[bold cyan] Job Apply Agent[/bold cyan]\n")
    console.print(f"[dim]Roles   : {', '.join(roles[:3])}[/dim]")
    console.print(f"[dim]Sources : Indeed India + RemoteOK[/dim]")
    console.print(f"[dim]Locations: {', '.join(locations[:3])}[/dim]\n")

    agent = AgentOrchestrator()
    message = (
        f'Search for "{roles[0]}" jobs in "{locations[0]}" (2 pages). '
        f"Process every job found. "
        f'Then search for "{roles[1]}" in "{locations[1]}" and do the same.'
    )

    with console.status("[bold green]Agent running...[/bold green]") as status:
        def on_tool(name: str, args: dict) -> None:
            preview = list(args.values())[:2]
            status.update(f"[dim][{name}] {' | '.join(str(v)[:40] for v in preview)}[/dim]")

        summary, results = await agent.run(message, on_tool_call=on_tool)

    processed = [r for r in results if r["tool"] == "process_job" and r["result"].get("processed")]
    skipped = [r for r in results if r["tool"] == "process_job" and r["result"].get("skipped")]
    searches = [r for r in results if r["tool"] == "search_jobs"]
    total_found = sum(r["result"].get("found", 0) for r in searches)

    console.print(f"\n[bold green] Done![/bold green]\n")
    console.print(f"  Jobs found   : [bold]{total_found}[/bold]")
    console.print(f"  Processed    : [bold green]{len(processed)}[/bold green]")
    console.print(f"  Skipped      : [bold yellow]{len(skipped)}[/bold yellow]")

    if processed:
        console.print("\n[bold yellow] Generated Resumes:[/bold yellow]")
        for r in processed:
            console.print(f"\n  [bold]{r['args']['company']}[/bold] — {r['args']['title']}")
            console.print(f"  [dim]Keywords : {', '.join(r['result'].get('keywords_matched', []))}[/dim]")
            console.print(f"  [dim]PDF      : {r['result']['resume_path']}[/dim]")
            console.print(f"  [dim]Apply    : {r['result']['apply_url']}[/dim]")

    if skipped:
        console.print("\n[dim] Skipped:[/dim]")
        for r in skipped:
            company = r["args"].get("company", "")
            console.print(f"  [dim]• {company} — {r['result']['reason']}[/dim]")

    if summary:
        console.print(f"\n[cyan] Agent summary:[/cyan]\n[dim]{summary}[/dim]")


def status() -> None:
    tracker = TrackerService()
    apps = tracker.get_all()

    console.print("\n[bold cyan] Application Tracker[/bold cyan]\n")

    if not apps:
        console.print("[dim]No applications yet. Run: python main.py crawl[/dim]")
        return

    by_status: dict[str, int] = {}
    for a in apps:
        by_status[a["status"]] = by_status.get(a["status"], 0) + 1

    colors = {"applied": "blue", "interview": "yellow", "offer": "green", "rejected": "red"}
    for s, count in by_status.items():
        color = colors.get(s, "white")
        console.print(f"  [{color}]{s:<12}[/{color}] : {count}")

    table = Table(box=box.SIMPLE, show_header=True, header_style="bold")
    table.add_column("Date", style="dim", width=12)
    table.add_column("Company", width=22)
    table.add_column("Role", width=30)
    table.add_column("Source", style="dim", width=14)
    table.add_column("Status", width=10)

    status_color = {"applied": "blue", "interview": "yellow", "offer": "green", "rejected": "red"}
    for a in reversed(apps[-15:]):
        date = datetime.fromisoformat(a["applied_at"]).strftime("%d %b %Y")
        sc = status_color.get(a["status"], "white")
        table.add_row(date, a["company"], a["title"], a["source"], f"[{sc}]{a['status']}[/{sc}]")

    console.print()
    console.print(table)


def show_help() -> None:
    console.print("\n[bold cyan] Job Apply Agent — Commands[/bold cyan]\n")
    console.print("  [bold]python main.py crawl[/bold]   [dim]Search jobs, tailor resumes, save tracker[/dim]")
    console.print("  [bold]python main.py status[/bold]  [dim]Show all tracked applications[/dim]")
    console.print("\n[cyan] First-time setup:[/cyan]")
    console.print("  [dim]1. cp .env.example .env[/dim]")
    console.print("  [dim]2. pip install -r requirements.txt[/dim]")
    console.print("  [dim]3. playwright install chromium[/dim]")
    console.print("  [dim]4. python main.py crawl[/dim]\n")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    match cmd:
        case "crawl":
            asyncio.run(crawl())
        case "status":
            status()
        case _:
            show_help()
