# Job Apply Agent — container image for Railway (Node.js + LaTeX for resume PDFs)
FROM node:20-bookworm-slim

# Skip Playwright's browser download during build. The Indeed crawler is the only
# feature that needs a browser; discovery (ATS APIs) and resume generation do not.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NODE_ENV=production

WORKDIR /app

# System deps:
#  - LaTeX packages the resume template uses (pdflatex, titlesec, enumitem,
#    xcolor, hyperref, fontawesome5 → texlive-fonts-extra, glyphtounicode).
#  - build tools so native npm modules (better-sqlite3) compile if no prebuilt.
RUN apt-get update && apt-get install -y --no-install-recommends \
      texlive-latex-base \
      texlive-latex-recommended \
      texlive-latex-extra \
      texlive-fonts-recommended \
      texlive-fonts-extra \
      python3 build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install node deps first for better layer caching.
COPY package*.json ./
RUN npm ci --omit=dev

# App source (node_modules, python/, secrets excluded via .dockerignore).
COPY . .

# Railway injects PORT at runtime; the server reads process.env.PORT (default 8080).
EXPOSE 8080
CMD ["node", "web/server.js"]
