---
name: files
description: Create, edit and inspect local Word (.docx), PDF, Excel (.xlsx) and PowerPoint (.pptx) files with standalone Python libraries, and reuse local templates. Use for file artifacts when the host has the documented Yard artifact runtime. Cloud document APIs and live Excel control use their own connectors.
---

# Standalone file artifacts

Use the configured `YARD_ARTIFACTS_PYTHON` executable. The Yard artifact runtime installs the versions in this plugin's `requirements.txt`: python-docx, openpyxl, python-pptx, reportlab, pypdf and Pillow. Visual checks additionally use LibreOffice (`YARD_ARTIFACTS_SOFFICE` or `soffice`) and Poppler (`pdftoppm`, `pdfinfo`). Read the relevant library's API documentation when needed. These are ordinary public dependencies; no App files, artifact-tool RPC or private container are involved.

If dependencies are missing, report the failing command and refer to Yard's `docs/standalone-plugins.md#local-file-artifacts`. Follow the user's authorized installation scope; keep environments, generated files and credentials outside the plugin package. A plugin's installation adds instructions; it does not install Python or LibreOffice.

Before editing, identify the input, required file type and final output path. Read existing content, sheets or slides first. Preserve source files and write edited output to a new path unless overwriting was requested. Keep temporary renders and scripts together in a task directory.

## Word

Use `python-docx` to read and author paragraphs, styles, tables, headers and footers. Use named styles, page geometry and explicit table widths. When using an existing document, load and edit that file so its style definitions and page setup survive. Advanced redlines, fields and unsupported Office features need specific validation; avoid claiming full Word fidelity from a successful save.

## PDF

Use `reportlab` for new PDFs; register an appropriate installed font for non-Latin text. Use `pypdf` for text/page extraction, merging and supported edits. Render with `pdftoppm` to inspect layout. Image-only PDFs require an explicitly available OCR tool; pypdf text extraction does not supply OCR.

## Spreadsheets

Use `openpyxl` for `.xlsx` data, formulas, styles, tables, native charts and validation. Read workbook/sheet metadata and the relevant ranges before editing. Keep calculations as formulas and distinguish missing values from zero. `openpyxl` writes formulas but does not calculate them. Where calculated results matter, save a working copy, recalculate with LibreOffice, then reload with `data_only=True` and verify the expected results and absence of formula errors. Preserve the user's original file when LibreOffice compatibility is uncertain. Macro-enabled, live-workbook and advanced Excel features need their own supported workflow.

## Presentations

Use `python-pptx` for editable slides, shapes, text, images and tables. Set slide dimensions, theme/fonts and a consistent grid before building. Keep content within the slide canvas and keep required content editable. Use an input `.pptx` as the starting point for template-based edits; inspect layouts and masters before adding slides. SmartArt, animation and unsupported native features need explicit preservation checks.

## Local templates

When the user supplies a template, copy it to the task directory, inspect its structure, then edit the copy using the matching library. Preserve styles, masters, reusable formulas and page settings relevant to the task. For a reusable template package, keep the reference file plus short instructions describing which content may change and how to validate the result. Persist or install that package only within the user's requested scope. This local workflow does not imply access to Google Docs, Slides, Sheets, or the user's live Excel session.

## Verification and delivery

Reopen each generated file with its authoring library and check required text, sheet values/formulas or slide count. Use LibreOffice's headless PDF conversion for `.docx` and `.pptx`, with a unique writable profile (`-env:UserInstallation=file:///absolute/task/profile`) to avoid sharing the user's desktop profile. Use Poppler to render PDF pages, then inspect the images for clipped text, overlap, missing glyphs and broken page/slide boundaries. Rendering is an actual check; a successful export alone does not establish layout quality.

Return the requested editable/final files with links. Keep temporary screenshots, test scripts and conversion profiles out of the deliverables unless requested. State material unsupported features and incomplete checks when they affect the result.
