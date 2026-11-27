# irbMASTER – AI-Assisted IRB Documentation

## Overview
YourPark is a web application designed to help researchers prepare IRB (Institutional Review Board) documents. I developed this project to reduce the time and effort required to prepare research ethics documents, which often involve complex forms and institution-specific requirements. The application uses AI to generate initial drafts from user-provided keywords while allowing researchers to review and edit the generated content.

## Tech Stack
- **Frontend:** Next.js, React, TypeScript, Tailwind CSS
- **Backend:** Next.js API Routes
- **Database:** SQLite, Prisma
- **Authentication:** NextAuth.js, bcrypt
- **AI:** Anthropic Claude API
- **Document Processing:** HWP/HWPX, XML, JSZip

## Key Features
- Institution-specific IRB module configuration.
- AI-assisted draft generation based on user-provided keywords.
- Modular editing of individual IRB document sections.
- Automatic saving of user edits.
- Offline draft storage and synchronization when connectivity is restored.
- Document processing and export to HWPX, DOCX, and PDF formats.
