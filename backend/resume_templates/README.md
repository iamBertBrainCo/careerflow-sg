# Resume templates

These HTML templates come from [sg-job-hunter](https://github.com/iamBertBrainCo/sg-job-hunter)
by Bertram Yang (MIT licence, see `LICENSE`). `resume_render.py` fills their `{{PLACEHOLDERS}}`
and drops any section that has no content, heading included.

ATS notes (measured in sg-job-hunter's `ats-rules.yml`): `standard`, `ats`, `compact` and
`executive` keep section headings intact when an ATS extracts the text. `modern`, `jake` and
`leadership` use letter-spacing or small-caps that can split headings into separate letters
("P R O F E S S I O N A L"), so they are marked "design-forward" in the app.
