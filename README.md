# Nexora Calc

A standalone handwritten-weight calculator built with React, Vite and Capacitor.

## Features
- Capture a page with the phone camera or choose an image from the gallery.
- Uses Tesseract.js local OCR with English and Bengali language data; no paid AI API or backend.
- First use needs an internet connection to download the language files. Tesseract.js caches language data in the browser/WebView, so later scans can work offline while the cache remains available.
- Review, edit, delete and manually add weight rows before calculating.
- Values such as `44,100` mean 44 kg 100 g.
- Automatic total in kilograms and grams.
- Save calculation history on the device.
- Export a PDF bill and share the bill text through WhatsApp.

## OCR notes
Local OCR is not a generative AI model and cannot guarantee correct recognition of handwriting. Clear, straight, well-lit photos work best. The app only accepts lines that look like a weight entry and always shows the detected entries for manual correction before calculation. Bengali handwriting recognition may be less accurate than printed text or English numerals.

## Android APK
Every push to `main` starts the GitHub Actions workflow **Build Nexora Calc APK**. Open the repository's **Actions** tab, select the latest completed successful run, and download the `Nexora-Calc-debug-APK` artifact. Extract the ZIP to get `app-debug.apk`.

## Local development
```bash
npm install
npm run dev
```

This project is independent and does not connect to Digital Ojon Khata, Nexora Ride, or any other application or backend.
