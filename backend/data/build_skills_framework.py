"""
Build data/skills_framework.json.gz from SkillsFuture's Skills Framework Dataset.

Source: https://jobsandskills.swda.gov.sg/frameworks/skills-frameworks
        ("Download the Latest Skills Framework Dataset", Excel, updated quarterly)

Usage (needs `pip install openpyxl`; run once during setup, the app reads the .json.gz):
    python data/build_skills_framework.py --download          # fetch the latest official file
    python data/build_skills_framework.py path/to/Skills-Framework-Dataset.xlsx

The dataset belongs to SkillsFuture Singapore. Its redistribution terms are not stated on the
download page, so this repo ships the script, not the data: each user downloads it themselves.

Output, keyed for small size:
    roles:  [{id, sector, track, role, description, functions: [critical work functions]}]
    needs:  {role_id: [[skill_code, level], ...]}          skills each role needs, at which level
    skills: {skill_code: {title, category, type, description, proficiency, abilities}}
            type is "tsc" (technical skill) or "ccs" (critical core skill)
"""

import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook


def rows(ws):
    it = ws.iter_rows(values_only=True)
    header = [str(h).strip() if h else "" for h in next(it)]
    for r in it:
        yield {header[i]: (str(v).strip() if v is not None else "") for i, v in enumerate(r) if i < len(header)}


def clip(text: str, n: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def main(xlsx: str, out: str):
    wb = load_workbook(xlsx, read_only=True, data_only=True)

    roles, role_ids = [], {}
    for r in rows(wb["Job Role_Description"]):
        key = (r["Sector"], r["Track"], r["Job Role"])
        if not r["Job Role"] or key in role_ids:
            continue
        role_ids[key] = len(roles)
        roles.append({"id": len(roles), "sector": r["Sector"], "track": r["Track"], "role": r["Job Role"],
                      "description": clip(r["Job Role Description"], 500), "functions": []})

    for r in rows(wb["Job Role_CWF_KT"]):
        rid = role_ids.get((r["Sector"], r["Track"], r["Job Role"]))
        cwf = r["Critical Work Function"]
        if rid is not None and cwf and cwf not in roles[rid]["functions"] and len(roles[rid]["functions"]) < 8:
            roles[rid]["functions"].append(clip(cwf, 120))

    needs = defaultdict(list)
    used_codes = set()
    for r in rows(wb["Job Role_TSC_CCS"]):
        rid = role_ids.get((r["Sector"], r["Track"], r["Job Role"]))
        code = r["TSC_CCS Code"]
        if rid is None or not code:
            continue
        level = r["Proficiency Level"]
        needs[rid].append([code, level])
        used_codes.add(code)

    skills = {}
    for r in rows(wb["TSC_CCS_Key"]):
        code = r["TSC Code"]
        if code in used_codes and code not in skills:
            skills[code] = {"title": r["TSC_CCS Title"], "category": r["TSC_CCS Category"], "type": r["TSC_CCS Type"],
                            "description": clip(r["TSC_CCS Description"], 400), "proficiency": "", "abilities": []}

    for r in rows(wb["TSC_CCS_K&A"]):
        code = r["TSC_CCS Code"]
        s = skills.get(code)
        if s is None:
            if code in used_codes:  # e.g. critical core skills listed only here
                s = skills[code] = {"title": r["TSC_CCS Title"], "category": r["TSC_CCS Category"], "type": r["TSC_CCS Type"],
                                    "description": clip(r["TSC_CCS Description"], 400), "proficiency": "", "abilities": []}
            else:
                continue
        if not s["proficiency"] and r["Proficiency Description"]:
            s["proficiency"] = clip(r["Proficiency Description"], 300)
        item = r["Knowledge / Ability Items"]
        if r["Knowledge / Ability Classification"].lower() == "ability" and item and len(s["abilities"]) < 3:
            s["abilities"].append(clip(item, 160))

    data = {"source": "SkillsFuture Skills Framework Dataset (jobsandskills.swda.gov.sg)",
            "roles": roles, "needs": {str(k): v for k, v in needs.items()}, "skills": skills}
    with gzip.open(out, "wt", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    print(f"{len(roles)} roles, {sum(len(v) for v in needs.values())} role-skill links, {len(skills)} skills -> {out} "
          f"({Path(out).stat().st_size / 1e6:.1f} MB)")


DATASET_URL = "https://file.go.gov.sg/jobsandskills-skillsfuture-skills-framework-dataset.xlsx"


def download() -> str:
    import tempfile
    import urllib.request

    path = Path(tempfile.gettempdir()) / "Skills-Framework-Dataset.xlsx"
    print(f"Downloading the Skills Framework dataset (~13 MB) from {DATASET_URL} ...")
    urllib.request.urlretrieve(DATASET_URL, path)
    return str(path)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    source = download() if sys.argv[1] == "--download" else sys.argv[1]
    main(source, sys.argv[2] if len(sys.argv) > 2 else str(Path(__file__).with_name("skills_framework.json.gz")))
