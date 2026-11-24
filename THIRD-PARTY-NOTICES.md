# Third-party notices

WhatsApp Auto is independently implemented application source. No HR configuration, records, credentials, session, private rules or branding assets are included. No application-source publication license is granted by this notice; confirm the owner's distribution license before public redistribution.

Runtime components include:

| Component | Pinned version | License / notice |
| --- | --- | --- |
| Node.js Windows x64 | 24.20.0 | Node.js license and bundled third-party notices are in `runtime/NODE-LICENSE.txt` in the portable release. |
| @whiskeysockets/baileys | 7.0.0-rc14 | MIT; installed package license remains under node_modules. Unofficial WhatsApp linked-device library. |
| Fastify | 5.12.8 | MIT; installed package license remains under node_modules. |
| qrcode | 1.5.4 | MIT; installed package license remains under node_modules. |
| Tailwind CSS / @tailwindcss/node (build only) | 4.3.5 | MIT. Compiled local stylesheet shipped; compiler not a runtime dependency. |
| Playwright (test only) | 1.58.2 | Apache-2.0; not included in the production dependency tree. |

Transitive dependencies keep their own package licenses/notices in the shipped `node_modules` tree. The exact locked dependency graph and integrity values are recorded in package-lock.json. Do not strip licenses when repackaging. The Node runtime ZIP is downloaded from the official Node distribution host and checked against SHA256 `6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba`. The release includes the official checksum list and an application file manifest.

WhatsApp and Meta names are trademarks of their respective owners. This app is not affiliated with or endorsed by them. Use the integration in accordance with the applicable service terms and with authorized recipients.
