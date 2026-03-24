# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MedRecruit Pro is a medical recruitment CRM — a single-page application for managing candidates, clients, job postings (postes), pipeline, invoicing (facturation), HR, and todos in the French healthcare recruitment sector.

## Architecture

- **Single-file SPA**: The entire app is a minified `index.html` (~600KB) containing a bundled React app with Tailwind CSS and Lucide icons. There is no separate build step or source directory — the HTML file IS the deployed artifact.
- **Backend**: Supabase (hosted) for data persistence and auth. Connection config is embedded in the bundle.
- **Serverless function**: `netlify/functions/extract-cv.js` — a Netlify Function that accepts a base64-encoded CV (PDF or image), sends it to the Anthropic API (Claude), and returns structured JSON with extracted candidate fields (nom, prenom, specialite, experience, diplome, RPPS, etc.).
- **Deployment**: Netlify. Config in `netlify.toml` (publish root `.`, functions in `netlify/functions`).

## App Sections (Navigation)

dashboard, clients, contacts, baseclients, basecandidats, base (candidate detail), bases, postes, pipeline, facturation, rh, todos

## CV Extraction Flow

1. Frontend reads file via `FileReader.readAsDataURL` (supports PDF and images)
2. Sends base64 + mimeType to `/.netlify/functions/extract-cv`
3. Serverless function calls Anthropic API with the document and a structured prompt
4. Returns JSON with: civilite, nom, prenom, telephone, email, specialite, sousSpecialite, experience, diplome, dateNaissance, rpps, disponibilite

## Key Constraints

- The `index.html` is minified/bundled — variable names are single-letter. When searching for functionality, search by string literals (French UI text, field names) rather than function names.
- `medrecruit_deploy/` is a duplicate folder from the zip extraction — the root files are the ones to edit.
- Environment variable `ANTHROPIC_API_KEY` must be set in Netlify for the CV extraction function.
