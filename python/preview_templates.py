"""
preview_templates.py
Renders all 4 HTML resume templates with sample data and opens them in the browser.
Usage: python preview_templates.py
"""

import os
import sys
import tempfile
import webbrowser
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

TEMPLATES_DIR = Path(__file__).parent / "templates"

# ── Sample resume data (JSON Resume schema) ──────────────────────────────────

SAMPLE_RESUME = {
    "basics": {
        "name": "Kalyaan Kanugula",
        "email": "kalyaan@example.com",
        "phone": "+1 (530) 321-0134",
        "location": "Chico, CA",
        "linkedin": "linkedin.com/in/kkalyaan",
        "github": "github.com/kkalyaan",
        "portfolio": "kalyaan.dev",
    },
    "summary": (
        "Software Engineer with an MS in Computer Science and hands-on experience "
        "building and monitoring distributed backend systems within globally deployed, "
        "high-availability infrastructure at Amazon. Proficient in Python, Java, and "
        "C++ with a strong foundation in observability, system diagnostics, and "
        "reliability engineering."
    ),
    "experience": [
        {
            "company": "California State University, Chico",
            "title": "Research Assistant",
            "location": "Chico, CA",
            "startDate": "September 2025",
            "endDate": "Present",
            "bullets": [
                "Designed and shipped a self-improving 4-agent LLM system end-to-end using Claude API and GLM 4.6, owning technical design, implementation, benchmarking, and observability infrastructure independently.",
                "Built observability and diagnostics infrastructure for a distributed multi-agent system, tracking per-turn logs, token costs, and agent diffs across 15+ configurable parameters using a SQLite-backed logging layer.",
            ],
        },
        {
            "company": "Amazon",
            "title": "Pricing Systems Engineer",
            "location": "Bangalore, India",
            "startDate": "December 2020",
            "endDate": "July 2023",
            "bullets": [
                "Monitored globally deployed pricing services serving millions of daily transactions, acting as DRI to detect degradation and restore 99.9% system availability.",
                "Reduced manual data validation effort by 95% by building Python ETL pipelines from scratch to ingest, transform, and reformat raw CSV data from upstream pricing systems.",
                "Maintained 90% system availability during pre-production cycles by executing large-scale simulation runs, triaging failures, and recommending corrective actions.",
                "Improved system reliability and reduced operational toil by migrating legacy pricing workflows to a serverless AWS architecture using Lambda, S3, and Athena, cutting release cycles from 2 days to 2 hours.",
            ],
        },
        {
            "company": "Amazon",
            "title": "ML Analyst",
            "location": "Hyderabad, India",
            "startDate": "October 2019",
            "endDate": "June 2020",
            "bullets": [
                "Improved ML model accuracy by 12% and boosted data throughput by 30% by tuning hyperparameters and automating dataset quality validation pipelines in Python.",
                "Increased annotation throughput by 18% by streamlining labeling SOPs without compromising model accuracy.",
            ],
        },
    ],
    "education": [
        {
            "institution": "California State University, Chico",
            "degree": "Master of Science",
            "field": "Computer Science",
            "startDate": "",
            "endDate": "August 2025",
            "gpa": "",
            "honors": [],
            "location": "Chico, CA",
        },
        {
            "institution": "Jawaharlal Nehru Technological University",
            "degree": "Bachelor of Science",
            "field": "Computer Science",
            "startDate": "",
            "endDate": "May 2019",
            "gpa": "",
            "honors": [],
            "location": "Hyderabad, India",
        },
    ],
    "skills": [
        {"category": "Programming", "items": ["Java", "Go", "Python", "C++", "Object-Oriented Programming"]},
        {"category": "Frameworks", "items": ["Spring Boot", "FastAPI", "REST APIs", "gRPC", "GraphQL"]},
        {"category": "Tools", "items": ["Git", "Maven", "Docker", "Kubernetes", "CI/CD", "Linux"]},
        {"category": "Cloud", "items": ["AWS Lambda", "S3", "Athena", "EC2", "SQS", "ECR"]},
        {"category": "Databases", "items": ["PostgreSQL", "Redis", "DynamoDB", "SimpleDB"]},
    ],
    "projects": [
        {
            "name": "GitLab Open Source Contributions",
            "startDate": "February 2025",
            "endDate": "Present",
            "link": "gitlab.com/go-gitlab",
            "bullets": [
                "Contributed production-quality Go code to the go-gitlab open source client, implementing Direct Transfer API support in bulk_imports.go with full unit test coverage.",
                "Exposed show_default_award_emoji in the GitLab Ruby API, MR approved pending final merge.",
            ],
        },
        {
            "name": "Cloud & Edge Face Recognition Platform",
            "startDate": "January 2025",
            "endDate": "May 2025",
            "link": "",
            "bullets": [
                "Built distributed AI inference platform sustaining 1,000 concurrent requests under 300ms latency using Docker containerization and auto-scaling across AWS EC2, S3, SQS, and Lambda.",
            ],
        },
        {
            "name": "Performance Benchmarking: REST vs GraphQL APIs",
            "startDate": "January 2025",
            "endDate": "May 2025",
            "link": "",
            "bullets": [
                "Architected and benchmarked REST and GraphQL APIs sustaining 10,000 req/sec with 40% P95 latency reduction over a 2.3M-row dataset using cursor-based pagination.",
            ],
        },
    ],
    "certifications": [
        {"name": "AWS Certified Solutions Architect", "issuer": "Amazon Web Services", "date": "2022"},
    ],
    "publications": [
        {
            "title": "Adaptive Multi-Agent LLM Systems for Self-Improving Code Generation",
            "journal": "Journal of Artificial Intelligence Research",
            "date": "2025",
            "link": "https://example.com/paper",
        }
    ],
    "awards": [],
    "volunteer": [],
    "languages": [],
}

# ── Metadata configs (one per template) ──────────────────────────────────────

TEMPLATE_CONFIGS = [
    {
        "template_file": "jake.html",
        "label": "jake",
        "meta": {
            "template": "jake",
            "role": "SDE",
            "level": "entry",
            "pages": 1,
            "activeSections": ["education", "skills", "projects", "experience"],
            "sectionOrder": ["education", "skills", "projects", "experience"],
        },
    },
    {
        "template_file": "faangpath.html",
        "label": "faangpath",
        "meta": {
            "template": "faangpath",
            "role": "PM",
            "level": "entry",
            "pages": 1,
            "activeSections": ["summary", "experience", "skills", "education", "certifications"],
            "sectionOrder": ["summary", "experience", "skills", "education", "certifications"],
        },
    },
    {
        "template_file": "myresume.html",
        "label": "myresume",
        "meta": {
            "template": "myresume",
            "role": "SDE",
            "level": "mid",
            "pages": 1,
            "activeSections": ["summary", "skills", "education", "experience", "projects"],
            "sectionOrder": ["summary", "skills", "education", "experience", "projects"],
        },
    },
    {
        "template_file": "sb2nov.html",
        "label": "sb2nov",
        "meta": {
            "template": "sb2nov",
            "role": "ML",
            "level": "entry",
            "pages": 1,
            "activeSections": ["education", "experience", "projects", "skills", "publications"],
            "sectionOrder": ["education", "experience", "projects", "skills", "publications"],
        },
    },
]

# ── Render and open ───────────────────────────────────────────────────────────

def main():
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))

    tmp_dir = tempfile.mkdtemp(prefix="resume_preview_")
    print(f"Writing rendered HTML to: {tmp_dir}\n")

    for config in TEMPLATE_CONFIGS:
        template = env.get_template(config["template_file"])
        html = template.render(resume=SAMPLE_RESUME, meta=config["meta"])

        out_path = os.path.join(tmp_dir, f"preview_{config['label']}.html")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(html)

        print(f"[{config['label']}] → {out_path}")
        webbrowser.open(f"file://{out_path}")

    print("\nAll 4 templates opened. Check your browser.")

if __name__ == "__main__":
    main()
