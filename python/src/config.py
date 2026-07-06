import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).parent.parent


class Config:
    OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://localhost:11434/v1")
    OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
    CRAWLER_DELAY_MS: int = int(os.getenv("CRAWLER_DELAY_MS", "2500"))
    MAX_JOBS: int = int(os.getenv("MAX_JOBS_PER_RUN", "20"))
    HEADFUL: bool = os.getenv("CRAWLER_HEADFUL", "false").lower() == "true"

    # Automatic daily crawl + job-description cache.
    # AUTO_CRAWL runs the crawler in the background every CRAWL_INTERVAL_HOURS.
    # JOB_CACHE_TTL_HOURS: how long a cached description is considered "fresh"
    # enough to serve to a user (and let a search skip the network entirely).
    AUTO_CRAWL: bool = os.getenv("AUTO_CRAWL", "true").lower() == "true"
    CRAWL_INTERVAL_HOURS: int = int(os.getenv("CRAWL_INTERVAL_HOURS", "24"))
    JOB_CACHE_TTL_HOURS: int = int(os.getenv("JOB_CACHE_TTL_HOURS", "24"))
    EMAIL_USER: str = os.getenv("EMAIL_USER", "")
    EMAIL_PASS: str = os.getenv("EMAIL_APP_PASSWORD", "")

    # Dashboard auth (single user, JWT)
    AUTH_USERNAME: str = os.getenv("AUTH_USERNAME", "admin")
    AUTH_PASSWORD: str = os.getenv("AUTH_PASSWORD", "changeme")
    JWT_SECRET: str = os.getenv("JWT_SECRET", "dev-insecure-secret-change-me")
    JWT_EXPIRE_HOURS: int = int(os.getenv("JWT_EXPIRE_HOURS", "12"))

    PROFILE_PATH: Path = BASE_DIR / "data" / "profile.json"
    APPLICATIONS_PATH: Path = BASE_DIR / "data" / "applications.json"  # legacy — migrated into DB
    DB_PATH: Path = BASE_DIR / "data" / "applications.db"
    CRAWL_STATE_PATH: Path = BASE_DIR / "data" / "crawl_state.json"  # persists last auto-crawl time
    RESUMES_DIR: Path = BASE_DIR / "resumes"
    IMPORTS_DIR: Path = BASE_DIR / "resumes" / "imported"


config = Config()
