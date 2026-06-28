/**
 * i18n.js — internationalisation de l'interface opérateur (FR / EN).
 *
 * La langue est stockée dans localStorage (clé LANG_KEY) et appliquée au DOM
 * via les attributs data-i18n (texte), data-i18n-title (attribut title),
 * data-i18n-placeholder (attribut placeholder) et data-i18n-aria-label.
 * Les chaînes générées dynamiquement passent par t(key, vars).
 *
 * Chargé avant operator.js : t() et applyI18n() sont disponibles globalement.
 */

const LANG_KEY = 'verso.lang';
const SUPPORTED_LANGS = ['fr', 'en'];
const DEFAULT_LANG = 'en';

const I18N = {
  fr: {
    // Onglets de recherche
    'tab.songs': 'Chants',
    'tab.bible': 'Bible',
    'tab.pdf': 'PDF',
    'tab.images': 'Images',
    'search.songsPlaceholder': 'Ex : 240',
    'search.biblePlaceholder': 'Ex : col3',
    'search.pdfPlaceholder': 'Rechercher un PDF',
    'search.imagePlaceholder': 'Rechercher une image',
    'songs.allBooks': 'Tous',
    'pdf.empty': 'Aucun PDF dans le dossier',
    'images.empty': 'Aucune image dans le dossier',
    // Barre d'outils
    'tools.settings': 'Paramètres',
    'tools.settingsTitle': 'Ouvrir les paramètres',
    'tools.shortcuts': 'Raccourcis',
    'tools.shortcutsShort': 'Racc.',
    'tools.shortcutsTitle': 'Raccourcis clavier',
    'tools.about': 'À propos',
    'tools.aboutTitle': 'À propos de Verso',
    // Retour projection + contrôles
    'monitor.label': 'Retour projection',
    'monitor.controls': 'Contrôles de projection',
    'monitor.screen': 'Écran',
    'monitor.screenTitle': "Choisir l'écran de projection",
    'monitor.project': 'Projeter',
    'monitor.projectTitle': "Ouvrir la projection sur l'écran sélectionné",
    'monitor.hide': 'Masquer',
    'monitor.hideTitle': 'Masquer tout le contenu',
    // État vide / panneaux
    'empty.title': 'Aucun contenu sélectionné',
    'empty.text': 'Choisissez un élément dans la barre latérale.',
    'song.edit': 'Modifier',
    'song.cancel': 'Annuler',
    'song.save': 'Sauvegarder',
    // Aide (raccourcis)
    'help.title': 'Raccourcis clavier',
    'help.tabs': "Changer d'onglet",
    'help.tabNext': 'Onglet suivant',
    'help.tabPrev': 'Onglet précédent',
    'help.search': 'Rechercher',
    'help.goToSearch': 'Aller au champ de recherche',
    'help.navResults': 'Naviguer dans les résultats',
    'help.validate': 'Valider la sélection',
    'help.project': 'Projeter',
    'help.itemNext': 'Élément suivant',
    'help.itemPrev': 'Élément précédent',
    'help.projectNext': "Projeter l'élément suivant",
    'help.clear': 'Vider la projection',
    'help.closeProjection': 'Fermer la fenêtre de projection (depuis cette fenêtre)',
    // À propos
    'about.desc': 'Projection de contenus pour les églises.',
    'about.version': 'Version',
    'about.author': 'Auteur : Arnaud Koechlin',
    'about.contact': 'Contact :',
    // Modale Paramètres
    'settings.title': 'Paramètres',
    'settings.sections': 'Rubriques',
    'settings.close': 'Fermer',
    'settings.navContent': 'Contenus',
    'settings.navLang': 'Langue',
    'settings.navUpdates': 'Mises à jour',
    'settings.contentTitle': 'Contenus',
    'settings.versoFolder': 'Dossier Verso',
    'settings.versoFolderDesc': 'Recueils, Bibles et médias.',
    'settings.open': 'Ouvrir',
    'settings.openInFinder': 'Ouvrir dans le Finder',
    'settings.openInExplorer': "Ouvrir dans l'explorateur",
    'settings.openVersoTitle': 'Ouvrir le dossier Verso',
    'settings.openVersoFinderTitle': 'Ouvrir le dossier Verso dans le Finder',
    'settings.openVersoExplorerTitle': "Ouvrir le dossier Verso dans l'explorateur",
    'settings.langTitle': 'Langue',
    'settings.langLabel': "Langue de l'interface",
    'settings.langDesc': "Choisissez la langue d'affichage de Verso.",
    'settings.updatesTitle': 'Mises à jour',
    'settings.checkUpdates': 'Vérifier les mises à jour',
    'settings.checkUpdatesDesc': 'Recherche une nouvelle version de Verso.',
    'settings.checkNow': 'Vérifier maintenant',
    'settings.installRestart': 'Installer et redémarrer',
    // Gestion des contenus
    'settings.songbooks': 'Recueils',
    'settings.bibles': 'Bibles',
    'settings.pdfs': 'PDF',
    'settings.images': 'Images',
    'settings.songbooksDesc': 'Recueils de chants (fichiers JSON).',
    'settings.biblesDesc': 'Traductions de la Bible (fichiers JSON).',
    'settings.pdfsDesc': 'Documents PDF à projeter.',
    'settings.imagesDesc': 'Images à projeter.',
    'settings.manage': 'Gérer',
    'settings.add': 'Ajouter',
    'settings.delete': 'Supprimer',
    'settings.contentEmpty': 'Aucun élément.',
    'settings.contentError': 'Erreur de chargement.',
    'settings.imported': '{count} fichier(s) ajouté(s).',
    'settings.importError': "Échec de l'ajout : {err}",
    'settings.deleteError': 'Échec de la suppression : {err}',
    'settings.deleteConfirmWord': 'SUPPRIMER',
    'settings.deleteConfirmPrompt': 'Tapez {word} pour confirmer',
    // Statuts de mise à jour
    'update.checking': 'Recherche…',
    'update.upToDate': 'Verso est à jour.',
    'update.available': 'Mise à jour disponible.',
    'update.availableVersion': 'Mise à jour disponible : version {version}.',
    'update.checkFailed': 'Échec de la vérification.',
    'update.installing': 'Installation…',
    'update.installFailed': "Échec de l'installation.",
    'update.installRetry': 'Échec, réessayer',
    'update.updateTo': 'Mettre à jour vers la version {version}',
    'update.update': 'Mettre à jour',
    // Libellés divers
    'verse.refrain': 'Refrain',
    'verse.strophe': 'Strophe',
    'list.live': 'En projection',
    'list.loading': 'Chargement…',
    'list.songsError': 'Erreur de chargement des chants : {err}',
    'list.noResult': 'Aucun résultat',
    'list.noBible': 'Aucune Bible. Déposez des fichiers JSON dans le dossier Verso.',
    'list.noBibleAvailable': 'Aucune Bible disponible.',
    'list.noBook': 'Aucun livre trouvé',
    'song.minOneVerse': 'Le chant doit avoir au moins une strophe.',
    'common.error': 'Erreur : {err}',
    'screen.main': 'Écran principal',
    'screen.numbered': 'Écran {n}',
    'screen.none': 'Aucun écran choisi',
    'screen.listFailed': 'Impossible de lister les écrans : {err}',
    'screen.noneDetected': 'Aucun écran détecté.',
    'screen.pickTitle': "Choisir l'écran de projection",
    'screen.primary': ' (principal)',
    'screen.position': 'position',
    'common.cancel': 'Annuler',
    'book.other': 'Autre',
  },
  en: {
    'tab.songs': 'Songs',
    'tab.bible': 'Bible',
    'tab.pdf': 'PDF',
    'tab.images': 'Images',
    'search.songsPlaceholder': 'e.g. 240',
    'search.biblePlaceholder': 'e.g. col3',
    'search.pdfPlaceholder': 'Search a PDF',
    'search.imagePlaceholder': 'Search an image',
    'songs.allBooks': 'All',
    'pdf.empty': 'No PDF in the folder',
    'images.empty': 'No image in the folder',
    'tools.settings': 'Settings',
    'tools.settingsTitle': 'Open settings',
    'tools.shortcuts': 'Shortcuts',
    'tools.shortcutsShort': 'Shrt.',
    'tools.shortcutsTitle': 'Keyboard shortcuts',
    'tools.about': 'About',
    'tools.aboutTitle': 'About Verso',
    'monitor.label': 'Projection preview',
    'monitor.controls': 'Projection controls',
    'monitor.screen': 'Screen',
    'monitor.screenTitle': 'Choose the projection screen',
    'monitor.project': 'Project',
    'monitor.projectTitle': 'Open projection on the selected screen',
    'monitor.hide': 'Hide',
    'monitor.hideTitle': 'Hide all content',
    'empty.title': 'No content selected',
    'empty.text': 'Pick an item in the sidebar.',
    'song.edit': 'Edit',
    'song.cancel': 'Cancel',
    'song.save': 'Save',
    'help.title': 'Keyboard shortcuts',
    'help.tabs': 'Switch tab',
    'help.tabNext': 'Next tab',
    'help.tabPrev': 'Previous tab',
    'help.search': 'Search',
    'help.goToSearch': 'Go to the search field',
    'help.navResults': 'Navigate results',
    'help.validate': 'Confirm selection',
    'help.project': 'Project',
    'help.itemNext': 'Next item',
    'help.itemPrev': 'Previous item',
    'help.projectNext': 'Project the next item',
    'help.clear': 'Clear projection',
    'help.closeProjection': 'Close the projection window (from this window)',
    'about.desc': 'Content projection for churches.',
    'about.version': 'Version',
    'about.author': 'Author: Arnaud Koechlin',
    'about.contact': 'Contact:',
    'settings.title': 'Settings',
    'settings.sections': 'Sections',
    'settings.close': 'Close',
    'settings.navContent': 'Content',
    'settings.navLang': 'Language',
    'settings.navUpdates': 'Updates',
    'settings.contentTitle': 'Content',
    'settings.versoFolder': 'Verso folder',
    'settings.versoFolderDesc': 'Songbooks, Bibles and media.',
    'settings.open': 'Open',
    'settings.openInFinder': 'Open in Finder',
    'settings.openInExplorer': 'Open in Explorer',
    'settings.openVersoTitle': 'Open the Verso folder',
    'settings.openVersoFinderTitle': 'Open the Verso folder in Finder',
    'settings.openVersoExplorerTitle': 'Open the Verso folder in Explorer',
    'settings.langTitle': 'Language',
    'settings.langLabel': 'Interface language',
    'settings.langDesc': "Choose Verso's display language.",
    'settings.updatesTitle': 'Updates',
    'settings.checkUpdates': 'Check for updates',
    'settings.checkUpdatesDesc': 'Look for a new version of Verso.',
    'settings.checkNow': 'Check now',
    'settings.installRestart': 'Install and restart',
    // Content management
    'settings.songbooks': 'Songbooks',
    'settings.bibles': 'Bibles',
    'settings.pdfs': 'PDF',
    'settings.images': 'Images',
    'settings.songbooksDesc': 'Song collections (JSON files).',
    'settings.biblesDesc': 'Bible translations (JSON files).',
    'settings.pdfsDesc': 'PDF documents to project.',
    'settings.imagesDesc': 'Images to project.',
    'settings.manage': 'Manage',
    'settings.add': 'Add',
    'settings.delete': 'Delete',
    'settings.contentEmpty': 'No items.',
    'settings.contentError': 'Failed to load.',
    'settings.imported': '{count} file(s) added.',
    'settings.importError': 'Add failed: {err}',
    'settings.deleteError': 'Delete failed: {err}',
    'settings.deleteConfirmWord': 'DELETE',
    'settings.deleteConfirmPrompt': 'Type {word} to confirm',
    'update.checking': 'Checking…',
    'update.upToDate': 'Verso is up to date.',
    'update.available': 'Update available.',
    'update.availableVersion': 'Update available: version {version}.',
    'update.checkFailed': 'Check failed.',
    'update.installing': 'Installing…',
    'update.installFailed': 'Installation failed.',
    'update.installRetry': 'Failed, retry',
    'update.updateTo': 'Update to version {version}',
    'update.update': 'Update',
    'verse.refrain': 'Chorus',
    'verse.strophe': 'Verse',
    'list.live': 'On screen',
    'list.loading': 'Loading…',
    'list.songsError': 'Failed to load songs: {err}',
    'list.noResult': 'No result',
    'list.noBible': 'No Bible. Drop JSON files in the Verso folder.',
    'list.noBibleAvailable': 'No Bible available.',
    'list.noBook': 'No book found',
    'song.minOneVerse': 'The song must have at least one verse.',
    'common.error': 'Error: {err}',
    'screen.main': 'Main screen',
    'screen.numbered': 'Screen {n}',
    'screen.none': 'No screen chosen',
    'screen.listFailed': 'Cannot list screens: {err}',
    'screen.noneDetected': 'No screen detected.',
    'screen.pickTitle': 'Choose the projection screen',
    'screen.primary': ' (primary)',
    'screen.position': 'position',
    'common.cancel': 'Cancel',
    'book.other': 'Other',
  },
};

let _lang = (function () {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored && SUPPORTED_LANGS.includes(stored)) return stored;
  } catch (_) {}
  return DEFAULT_LANG;
})();

/** Langue active ('fr' | 'en'). */
function currentLang() {
  return _lang;
}

/** Traduit une clé, avec interpolation de {vars}. Repli sur FR puis la clé. */
function t(key, vars) {
  const table = I18N[_lang] || I18N[DEFAULT_LANG];
  let s = table[key];
  if (s === undefined) s = I18N[DEFAULT_LANG][key];
  if (s === undefined) return key;
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  }
  return s;
}

/** Applique les traductions à tout le DOM marqué (texte, title, placeholder, aria-label). */
function applyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  scope.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  scope.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
  // Forme courte responsive (CSS lit data-short via ::after).
  scope.querySelectorAll('[data-i18n-short]').forEach(el => {
    el.setAttribute('data-short', t(el.dataset.i18nShort));
  });
  document.documentElement.lang = _lang;
}

/**
 * Change la langue, persiste le choix et réapplique le DOM. Les listes
 * dynamiques (onglet courant) sont reconstruites par le callback onChange.
 */
function setLang(lang, onChange) {
  if (!SUPPORTED_LANGS.includes(lang) || lang === _lang) return;
  _lang = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
  applyI18n();
  if (typeof onChange === 'function') onChange(lang);
}
