# Nexora Calc

A standalone handwritten-weight calculator built with React, Vite and Capacitor.

## Current features
- Capture a page with the phone camera or choose an image from the gallery.
- OCR reads English and Bengali digits using Tesseract.js.
- Review, edit, delete and manually add weight rows before calculating.
- Values such as `44,100` mean 44 kg 100 g.
- Automatic total in kilograms and grams.
- Save calculation history on the device.
- Export a PDF bill and share the bill text through WhatsApp.

## Important OCR note
Handwriting recognition is not perfect. The app always shows the recognized rows for correction before calculating. Bengali handwriting may be difficult to recognize. Tesseract language data is fetched the first time OCR is used, so the first scan requires an internet connection; this initial version is not fully offline.

## Android APK
Every push to `main` starts the GitHub Actions workflow **Build Nexora Calc APK**. Open the repository's **Actions** tab, select the completed run, and download the `Nexora-Calc-debug-APK` artifact. Extract the ZIP to get `app-debug.apk`.

## Local development
```bash
npm install
npm run dev
```

This project is independent and does not connect to other applications or backends.
