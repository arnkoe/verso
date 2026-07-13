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

La fixture Bible expose des attributs `data-testid` sur les principaux axes à
comparer : onglet et ligne actifs de la sidebar, kicker, traduction active et
verset actif. Elle doit être vérifiée au-dessus et en dessous du breakpoint de
900 px.
