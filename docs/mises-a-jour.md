# Mises à jour de Verso

Verso vérifie au démarrage si une nouvelle version existe, via le plugin officiel
`tauri-plugin-updater`. La détection est **silencieuse** : si aucune mise à jour
n'est disponible (ou en cas de souci réseau), rien n'apparaît. Si une mise à jour
existe, une petite pastille discrète s'affiche en bas de la barre latérale de la
fenêtre opérateur. Un clic télécharge, installe et relance Verso.

## Fonctionnement technique

- L'app interroge `https://github.com/arnkoe/verso/releases/latest/download/latest.json`.
- Ce fichier (généré automatiquement à chaque release) contient la dernière
  version, les URLs des bundles et leurs signatures.
- Le bundle n'est installé que si sa **signature** correspond à la clé publique
  embarquée dans l'app (`plugins.updater.pubkey` dans `tauri.conf.json`). C'est ce
  qui empêche l'installation d'un binaire non authentique.

## Préparation unique : générer les clés de signature

À faire **une seule fois**.

```sh
npm run tauri signer generate -- -w ~/.verso-updater.key
```

La commande affiche :

- une **clé publique** (chaîne en base64) ;
- une **clé privée** écrite dans `~/.verso-updater.key`, protégée par un mot de
  passe que vous choisissez.

Ensuite :

1. Collez la clé publique dans `src-tauri/tauri.conf.json`, à la place de
   `REMPLACER_PAR_LA_CLE_PUBLIQUE_GENEREE` (champ `plugins.updater.pubkey`).
2. Dans GitHub → Settings → Secrets and variables → Actions, ajoutez deux secrets :
   - `TAURI_SIGNING_PRIVATE_KEY` : le **contenu** du fichier `~/.verso-updater.key`.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` : le mot de passe choisi.

> Conservez la clé privée et son mot de passe en lieu sûr. Si vous les perdez,
> les versions déjà installées ne pourront plus se mettre à jour automatiquement
> (il faudrait redistribuer une nouvelle clé publique manuellement).

## Publier une nouvelle version

1. Mettez à jour le numéro de version aux deux endroits :
   - `package.json` → `version`
   - `src-tauri/tauri.conf.json` → `version`
   - (`src-tauri/Cargo.toml` → `version`, pour rester cohérent)
2. Commit, puis créez un tag `v<version>` et poussez-le :

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. Le workflow `.github/workflows/release.yml` se déclenche, construit Verso pour
   macOS (Apple Silicon + Intel) et Windows, signe les bundles, publie la release
   et génère `latest.json`.

Au prochain lancement, les utilisateurs verront la pastille de mise à jour.

## Notes

- La signature de l'updater (ci-dessus) authentifie la mise à jour, mais ne
  remplace pas la **signature de distribution** du système d'exploitation. Sans
  certificat Apple/Microsoft, macOS et Windows afficheront un avertissement à la
  première installation. La mise à jour automatique fonctionne malgré tout une
  fois l'app installée.
- Pour tester sans publier : créez une release de pré-version (tag `vX.Y.Z`),
  l'updater la détectera si elle est plus récente.
