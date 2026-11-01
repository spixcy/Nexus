# CheatPet Study Desk

An independent Chrome Manifest V3 practice assistant informed by the public Quizonator product pages. It is built for questions the user chooses to study; it does not select or submit quiz answers.

## Local development

```powershell
npm install
npm run dev
```

Build the extension bundle with `npm run build`, then load the `dist/` folder through `chrome://extensions` → **Load unpacked**. Settings are opened from the extension's details page or the Study Desk settings control.

The first configured provider will be OpenAI with your own API key. Add the key in Settings; it is kept in extension storage and sent directly to OpenAI only for a question you submit. No key is required to use the manual editor, history, or saved-question list.

## Project status

The reference research and screenshot captures are under [`research/`](research/). The product uses its own branding and interface. Provider integrations beyond OpenAI and platform-specific question extraction are not part of the first release.
