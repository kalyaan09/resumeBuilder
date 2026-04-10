"""
test_extractor.py — run as: python test_extractor.py

Reads ANTHROPIC_API_KEY from environment (or ~/.resume-editor/config.json),
extracts myresume.tex into JSON Resume schema, and prints the result.
"""

import json
import os
import sys
from pathlib import Path

# Make sure imports resolve from the python/ directory regardless of cwd
HERE = Path(__file__).parent.resolve()
sys.path.insert(0, str(HERE))

from llm_client import LLMClient
from resume_extractor import extract_text_from_file, extract_resume_to_json

# ── Config ────────────────────────────────────────────────────────────────────

RESUME_FILE = Path("/Users/kalyaankanugula/Documents/res_app/template/myresume.tex")


def get_llm_config() -> dict:
    # 1. Try ~/.resume-editor/config.json (written by the app)
    cfg_file = Path.home() / ".resume-editor" / "config.json"
    if cfg_file.exists():
        data = json.loads(cfg_file.read_text())
        llm = data.get("llm_config") or data.get("model_config") or data
        if llm.get("provider") and llm.get("api_key"):
            print(f"Config: {llm['provider']} / {llm['model']}")
            return llm

    # 2. Fall back to env vars
    if os.environ.get("GEMINI_API_KEY"):
        print("Config: gemini / gemini-3-flash-preview  (from GEMINI_API_KEY)")
        return {
            "provider": "gemini",
            "model": "gemini-3-flash-preview",
            "api_key": os.environ["GEMINI_API_KEY"],
        }
    if os.environ.get("ANTHROPIC_API_KEY"):
        print("Config: anthropic / claude-sonnet-4-6  (from ANTHROPIC_API_KEY)")
        return {
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
            "api_key": os.environ["ANTHROPIC_API_KEY"],
        }
    if os.environ.get("OPENAI_API_KEY"):
        print("Config: openai / gpt-4o  (from OPENAI_API_KEY)")
        return {
            "provider": "openai",
            "model": "gpt-4o",
            "api_key": os.environ["OPENAI_API_KEY"],
        }

    if os.environ.get("OLLAMA_MODEL"):
        model = os.environ["OLLAMA_MODEL"]
        print(f"Config: ollama / {model}  (from OLLAMA_MODEL)")
        return {
            "provider": "ollama",
            "model": model,
            "api_key": "ollama",
            "base_url": "http://localhost:11434/v1",
        }

    print("No API key found. Options:")
    print("  export ANTHROPIC_API_KEY=sk-ant-...")
    print("  export OPENAI_API_KEY=sk-...")
    print("  export OLLAMA_MODEL=gemma3      (local, no key needed — brew install ollama)")
    sys.exit(1)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"\nFile : {RESUME_FILE}")
    print(f"Exists: {RESUME_FILE.exists()}\n")

    if not RESUME_FILE.exists():
        print("ERROR: file not found")
        sys.exit(1)

    file_bytes = RESUME_FILE.read_bytes()
    extension = RESUME_FILE.suffix.lower()   # ".tex"

    # Show the cleaned text going into the LLM
    print("=" * 60)
    print("STEP 1 — Extracted text (what the LLM receives)")
    print("=" * 60)
    raw_text = extract_text_from_file(file_bytes, extension)
    print(raw_text)
    print(f"\n({len(raw_text)} chars)\n")

    # Call the LLM
    config = get_llm_config()
    client = LLMClient.from_config(config)

    print("=" * 60)
    print("STEP 2 — Calling LLM (10-30s)...")
    print("=" * 60)
    result = extract_resume_to_json(file_bytes, extension, client)

    print("\n" + "=" * 60)
    print("STEP 3 — Extracted JSON Resume")
    print("=" * 60)
    print(json.dumps(result, indent=2))

    # Save next to the input file
    out = RESUME_FILE.with_suffix(".extracted.json")
    out.write_text(json.dumps(result, indent=2))
    print(f"\nSaved → {out}")


if __name__ == "__main__":
    main()
