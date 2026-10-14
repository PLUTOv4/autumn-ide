# Third-party notices

Autumn's own code is under the PolyForm Noncommercial License 1.0.0 (see `LICENSE`). The components below come from other projects and keep their own licenses.

## Included in Autumn

| Component | Where | License | Full text |
|---|---|---|---|
| [Pretendard](https://github.com/orioncactus/pretendard) 1.3.9, variable | `src/fonts/PretendardVariable.woff2` | SIL Open Font License 1.1 | `src/fonts/LICENSE-Pretendard.txt` |
| [html-to-image](https://github.com/bubkoo/html-to-image) | `src/vendor/html-to-image.js` (PNG export) | MIT | `src/vendor/LICENSE-html-to-image.txt` |
| Icon shapes similar to [Lucide](https://github.com/lucide-icons/lucide) and [Feather](https://github.com/feathericons/feather) | some icons in `src/icons.js` | ISC and MIT | `src/LICENSE-icons.txt` |
| [Electron](https://www.electronjs.org) and Chromium | `app\` in a build | MIT, plus the licenses of Chromium's parts | `app\LICENSE`, `app\LICENSES.chromium.html` |

### Pretendard

The font file is the original release file, unchanged (internal name "Pretendard Variable", version 1.309, © Kil Hyung-jin). The OFL allows it to be bundled with software and distributed with it, including in software that is sold, as long as the license is distributed with it. Its license file sits next to the font in the source and in every build. The font may not be sold on its own, and a modified version may not use the reserved names Pretendard, Source, Inter or M PLUS 1. Documents made with Autumn, such as PDFs, may contain the font; the OFL places no conditions on them.

### FFmpeg in Electron

Electron loads FFmpeg from `ffmpeg.dll` (LGPL 2.1); its notice is part of `LICENSES.chromium.html`. Electron's standard copy can play H.264 and AAC, which are covered by patents. Autumn does not play audio or video, so `node scripts/build.js --free-ffmpeg` replaces that file with the copy Electron publishes without those codecs (`ffmpeg-v<version>-win32-x64.zip` from the Electron release). The build also uses that copy automatically when the zip is already in the Electron download cache. The released Autumn.exe is built this way.

## Used only for building

These tools are installed by the build into `%LOCALAPPDATA%\Autumn-build`. They are not part of the source or of the app.

| Component | Used for | License |
|---|---|---|
| [@electron/packager](https://github.com/electron/packager) | packaging the app | BSD-2-Clause |
| [acorn](https://github.com/acornjs/acorn) | generating the Korean UI (`scripts/i18n.js`) | MIT |
| C# compiler of the .NET Framework (part of Windows) | compiling the `Autumn.exe` launcher | Windows component; the launcher is Autumn's own code |

## System fonts

The styles name Segoe UI, Malgun Gothic, Consolas, Cascadia Code, Apple SD Gothic Neo and D2Coding as fallbacks. None of these font files are included. When Autumn makes a PDF, the glyphs it uses may be embedded in the file, which these fonts permit.

## Artwork

The app icon in `assets/` and the screenshots in `docs/` were made for this project.
