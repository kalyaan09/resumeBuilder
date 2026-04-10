"""
test_extract.py
Test /extract-resume by running the extraction pipeline directly
(no HTTP server needed).

Usage:
    python test_extract.py [path/to/resume.tex]

Loads LLM config from ~/.resume-editor/config.json or ANTHROPIC_API_KEY env var.
"""

import sys
import json
import os
from pathlib import Path

# ── Load LLM config ───────────────────────────────────────────────────────────

def load_llm_config() -> dict:
    config_path = Path.home() / ".resume-editor" / "config.json"
    if config_path.exists():
        with open(config_path) as f:
            stored = json.load(f)
        llm = stored.get("llm_config") or stored.get("model_config") or stored
        if llm.get("provider") and llm.get("model"):
            print(f"[config] loaded from {config_path}")
            print(f"[config] provider={llm['provider']}  model={llm['model']}")
            return llm

    # Fallback: check common env vars
    if os.environ.get("ANTHROPIC_API_KEY"):
        print("[config] using ANTHROPIC_API_KEY from environment")
        return {
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
            "api_key": os.environ["ANTHROPIC_API_KEY"],
        }
    if os.environ.get("OPENAI_API_KEY"):
        print("[config] using OPENAI_API_KEY from environment")
        return {
            "provider": "openai",
            "model": "gpt-4o",
            "api_key": os.environ["OPENAI_API_KEY"],
        }

    print(
        "ERROR: No LLM config found.\n"
        "Either create ~/.resume-editor/config.json with your API key,\n"
        "or set ANTHROPIC_API_KEY / OPENAI_API_KEY in your environment."
    )
    sys.exit(1)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    resume_path = Path(
        sys.argv[1] if len(sys.argv) > 1
        else "/Users/kalyaankanugula/Documents/res_app/template/myresume.tex"
    )

    if not resume_path.exists():
        print(f"ERROR: File not found: {resume_path}")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  Extracting: {resume_path.name}")
    print(f"{'='*60}\n")

    # Import here so the working directory doesn't matter
    sys.path.insert(0, str(Path(__file__).parent))
    from llm_client import LLMClient
    from resume_extractor import extract_resume_to_json, extract_text_from_file

    llm_config = load_llm_config()
    client = LLMClient.from_config(llm_config)

    file_bytes = resume_path.read_bytes()
    ext = resume_path.suffix.lower()

    # Show the intermediate extracted text so we can verify it looks clean
    print("── RAW TEXT (what the LLM sees) " + "─" * 28)
    raw_text = extract_text_from_file(file_bytes, ext)
    print(raw_text)
    print("\n" + "─" * 60)
    print(f"[{len(raw_text)} chars extracted from {ext}]")
    print("─" * 60 + "\n")

    print("── Calling LLM... (this may take 10-30s) ──────────────────\n")
    result = extract_resume_to_json(file_bytes, ext, client)

    print("── EXTRACTED JSON RESUME ──────────────────────────────────\n")
    print(json.dumps(result, indent=2))

    # Save result alongside the input file for easy inspection
    out_path = resume_path.with_suffix(".extracted.json")
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\n── Saved to: {out_path}")


if __name__ == "__main__":
    main()
