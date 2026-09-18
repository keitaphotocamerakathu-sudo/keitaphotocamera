KEITA PHOTO TOOLS v17.3
- index.html: Production workflow. Uses trained KEITA AI profile during Smart Culling when enough KEEP/REJECT examples exist.
- teach.html: Separate training room. Labels are stored locally in IndexedDB and shared with index.html on the same origin.
- No cloud API / no paid service required.
- Back up training profile from teach.html because clearing browser site data can remove IndexedDB.
