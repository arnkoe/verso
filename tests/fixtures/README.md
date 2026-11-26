# Fixtures UI

Ces pages statiques réutilisent directement les feuilles de style de
l’application avec des données déterministes. Elles permettent de contrôler
les alignements sans dépendre des API Tauri ni des fichiers locaux de
l’opérateur.

Depuis la racine du dépôt :

```sh
python3 -m http.server 4173
```

Puis ouvrir :

- `http://127.0.0.1:4173/tests/fixtures/operator-bible.html`
- `http://127.0.0.1:4173/tests/fixtures/operator-pdf.html`

La fixture Bible expose des attributs `data-testid` sur les principaux axes à
comparer : onglet et ligne actifs de la sidebar, kicker, traduction active et
verset actif. Elle doit être vérifiée au-dessus et en dessous du breakpoint de
900 px.

La fixture PDF montre l’onglet PDF avec le bouton d’ajout (`data-testid="add-media"`)
à droite du champ de recherche : il doit être carré, de la hauteur du champ
(`--control-h`), et aligné sur lui. Le sélecteur de fichiers et le
glisser-déposer ne sont pas testables ici (API Tauri absentes).

La fixture Réglages OpenLyrics charge la vraie fenêtre Réglages
(`src/utility.html`) avec une API Tauri simulée
(`settings-openlyrics-stub.js`, données fixes, aucun accès fichier) :

- `http://127.0.0.1:4173/tests/fixtures/settings-openlyrics.html?window=settings`
  (ajouter `&lang=en` pour l'anglais)

Ouvrir Contenus > Recueils > Gérer : date d'ajout sous chaque recueil,
boutons Exporter et Importer OpenLyrics…, boîte « Importer un recueil ».
`window.__fixtureCalls` liste les appels simulés ; `window.__fixtureFail`
(`import`, `export`) force les messages d'échec.
