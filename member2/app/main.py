from fastapi import FastAPI

app = FastAPI(
    title="Web Scraping & Data Collection API",
    description="Member 2 - Automated Web Scraping System",
    version="1.0.0",
)


@app.get("/")
def home():
    return {
        "message": "Web Scraping API is running",
        "module": "Member 2 - Data Collection",
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "scraping-api",
    }