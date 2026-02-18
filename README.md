# Naukri → LinkedIn Extension

A Chrome extension that helps you quickly search for company employees on LinkedIn when browsing job listings on Naukri.com.

## Features

- **Keyboard Shortcut**: Press `Ctrl+Shift+L` (or `Cmd+Shift+L` on Mac) on any Naukri job listing to instantly search the company on LinkedIn
- **Google Dork Search**: Automatically generates Google dork queries to find company employees on LinkedIn
- **Popup Interface**: Clean popup UI for easy access and settings
- **Seamless Integration**: Works directly on Naukri.com job listing pages

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select this extension's folder
5. The extension icon will appear in your toolbar

## Usage

1. Navigate to any job listing on [Naukri.com](https://www.naukri.com)
2. Press `Ctrl+Shift+L` to search the company on LinkedIn
3. Or click the extension icon to use the popup interface

## Files

| File | Description |
|------|-------------|
| `manifest.json` | Extension configuration (Manifest V3) |
| `background.js` | Service worker for background tasks |
| `content.js` | Content script injected into Naukri pages |
| `popup.html` | Extension popup UI |
| `popup.js` | Popup interaction logic |
| `icons/` | Extension icons (16px, 48px, 128px) |

## Permissions

- **tabs**: To open new tabs for LinkedIn/Google searches
- **scripting**: To extract company information from Naukri pages
- **storage**: To save user preferences

## License

MIT License
