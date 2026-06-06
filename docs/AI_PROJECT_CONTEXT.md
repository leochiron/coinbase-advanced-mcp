# Contexte pedagogique du projet Coinbase Local MCP

Ce document sert a donner du contexte a une IA externe qui doit aider a expliquer, presenter ou ecrire un cours autour de ce projet.

Ce n'est pas un guide d'exploitation pour un agent de trading. Ce n'est pas non plus une consigne pour executer des ordres. Le but est de comprendre le projet, son architecture, ses choix techniques, ses choix de securite et les fonctionnalites qui ont ete ajoutees au fil du developpement.

Ne jamais inclure de secrets dans un cours ou une explication publique : pas de cle API, pas de cle privee, pas de token, pas d'identifiant complet de compte Coinbase, pas de mot de passe FTP, pas de contenu de `.env` ou de `config.local.php`.

## Resume court

Le projet est un serveur MCP local en Node.js et TypeScript qui connecte une IA locale, par exemple Codex, a Coinbase Advanced Trade.

Il permet a l'IA de lire un portefeuille Coinbase, de recuperer les prix de marche, d'analyser une allocation, de preparer des ordres, de simuler des ordres en paper trading, puis, si l'utilisateur l'autorise explicitement, d'executer ou d'annuler des ordres reels.

Le projet est concu autour d'une idee simple : donner a l'IA un acces technique utile, mais garder l'humain responsable et decisionnaire. Par defaut, le serveur lit les donnees et prepare des ordres, mais ne place rien en reel. Toute action reelle est bloquee par plusieurs verrous : activation volontaire du trading, dry-run ou proposition preexistante, phrase de confirmation exacte et audit local.

## Probleme que le projet resout

Les interfaces Coinbase classiques permettent de voir son portefeuille et de passer des ordres, mais elles ne sont pas pensees pour une conversation structurante avec une IA.

Ce projet ajoute une couche intermediaire entre une IA locale et Coinbase :

- l'IA peut recuperer l'etat du portefeuille ;
- l'IA peut calculer des repartitions et des ecarts d'allocation ;
- l'IA peut preparer des ordres coherents techniquement ;
- l'utilisateur peut verifier les ordres avant execution ;
- l'historique local garde une trace des propositions, dry-runs, executions et annulations ;
- aucune fonction de retrait ou de transfert n'existe dans le projet.

Le projet ne cherche pas a creer un robot de trading autonome. Il construit plutot un workflow de trading assiste par IA, avec validation humaine.

## Architecture generale

L'architecture principale est la suivante :

```text
IA locale / client MCP
        |
        | MCP stdio
        v
Serveur Node.js + TypeScript
        |
        | Services internes
        v
Coinbase Advanced Trade API
        |
        v
Portefeuille, produits, prix, ordres, historique

En parallele :

SQLite local
        |
        v
Audit, dry-runs, propositions, paper trading, cancellations

Optionnel :

PHP guard distant
        |
        v
Cron de surveillance quand l'ordinateur local est eteint
```

Le transport principal est MCP `stdio`. Cela signifie que le client IA lance le serveur localement et communique avec lui via stdin/stdout en JSON-RPC. Ce choix evite d'exposer un serveur HTTP local inutilement.

Un transport HTTP existe dans l'arborescence, mais il est volontairement laisse inactif comme placeholder. L'objectif prioritaire reste l'usage local.

## Technologies utilisees

Le projet utilise :

- Node.js 20+ ;
- TypeScript strict ;
- SDK MCP TypeScript officiel ;
- Zod pour valider les entrees des outils ;
- dotenv pour charger la configuration ;
- SQLite via `better-sqlite3` pour l'audit local ;
- Vitest pour les tests ;
- ESLint et Prettier pour la qualite de code ;
- Coinbase Advanced Trade API pour les comptes, produits, tickers, ordres et historique ;
- un petit module PHP optionnel pour une surveillance distante par cron.

## Structure du projet

Les principaux dossiers sont :

```text
src/
    coinbase/    Client Coinbase, authentification JWT, types et erreurs
    config/      Chargement et validation de l'environnement
    server/      Creation du serveur MCP et transports
    services/    Logique metier : portefeuille, prix, allocation, ordres, audit
    storage/     SQLite et migrations
    tools/       Definition des outils MCP exposes a l'IA
    utils/       Validation, redaction des secrets, logs, idempotence

scripts/
    Watcher deux etapes et scripts de deploiement du guard PHP

server/
    coinbase-guard/     Guard PHP/cron optionnel
    projet-secret-root/ Protection minimale du dossier web parent

docs/
    Documentation, contexte pedagogique, watcher, onboarding

knowledge/
    Registre de sources validees par l'utilisateur

data/
    Etat runtime local : audit SQLite, logs, watcher, paper trading
```

## Le serveur MCP

Le serveur MCP expose des outils que l'IA peut appeler. Ces outils sont en snake_case, par exemple :

- `get_server_status`
- `get_coinbase_accounts`
- `get_coinbase_products`
- `get_product_ticker`
- `get_portfolio_snapshot`
- `analyze_portfolio_allocation`
- `propose_limit_orders`
- `propose_stop_limit_orders`
- `create_order_dry_run`
- `execute_validated_order`
- `list_open_orders`
- `cancel_validated_order`
- `get_order_history`
- `get_audit_log`
- `get_paper_portfolio`
- `process_paper_orders`
- `reset_paper_portfolio`
- `get_knowledge_base`
- `add_knowledge_source`

Chaque outil recoit des parametres strictement valides par Zod. Les erreurs recuperables sont renvoyees comme erreurs d'outil, pas comme crash du serveur.

Le serveur ecrit ses logs sur stderr. En mode MCP stdio, stdout est reserve au protocole MCP.

## Integration Coinbase

Le client Coinbase encapsule les endpoints Advanced Trade `/api/v3/brokerage`.

Il sait notamment :

- lister les comptes ;
- lister les produits ;
- lire un produit ;
- lire un ticker ;
- recuperer un ordre ;
- lister l'historique d'ordres ;
- creer un ordre ;
- annuler un ordre ;
- recuperer la decomposition de portefeuille quand Coinbase la fournit.

L'authentification se fait avec une cle CDP Coinbase :

- `COINBASE_API_KEY_NAME` ;
- `COINBASE_API_PRIVATE_KEY`.

Le serveur genere un Bearer token JWT par requete. Les cles Coinbase au format EC SEC1, par exemple `-----BEGIN EC PRIVATE KEY-----`, sont normalisees en PKCS#8 avant signature.

Le projet ne contient aucune fonction de retrait, transfert, send, payout ou equivalent. Meme si une cle Coinbase avait des permissions trop larges, le serveur n'expose pas d'outil MCP permettant de sortir des fonds.

## Configuration

Les variables principales sont :

```text
COINBASE_API_KEY_NAME
COINBASE_API_PRIVATE_KEY
COINBASE_API_BASE_URL=https://api.coinbase.com
COINBASE_TRADING_ENABLED=false
DEFAULT_QUOTE_CURRENCY=EUR
AUDIT_DATABASE_PATH=./data/audit.sqlite
KNOWLEDGE_SOURCES_PATH=./knowledge/sources.json
MCP_TRANSPORT=stdio
MCP_HTTP_PORT=3333
LOG_LEVEL=info
PAPER_TRADING_ENABLED=false
PAPER_STARTING_CASH=10000
PAPER_FEE_BPS=60
RISK_LIMITS_ENABLED=false
MAX_DAILY_NOTIONAL=0
```

Le fichier `.env` n'est pas versionne. Le serveur charge `.env` depuis la racine du projet, meme si le processus est lance depuis un autre dossier.

## Mode lecture et analyse

La partie lecture sert a comprendre l'etat du portefeuille :

- balances par actif ;
- valeur estimee en devise de reference ;
- poids par actif ;
- actifs non valorises si une paire de prix manque ;
- ordres ouverts ;
- historique Coinbase et historique local.

`get_portfolio_snapshot` utilise en priorite Coinbase Portfolio Breakdown quand disponible. Cela rapproche le total de l'interface Coinbase, mais il faut garder en tete que certaines positions peuvent etre stakees ou non liquides. Un solde visible dans le portefeuille n'est pas toujours vendable directement en spot.

`analyze_portfolio_allocation` fait une analyse mecanique. Il peut comparer le portefeuille actuel a une allocation cible, calculer les ecarts, identifier les surponderations et sous-ponderations, et signaler une concentration. Il ne doit pas etre presente comme conseil financier personnalise.

## Workflow de preparation d'ordre

Le projet distingue clairement preparation et execution.

La preparation peut passer par :

- `propose_limit_orders` ;
- `propose_stop_limit_orders` ;
- `create_order_dry_run`.

Ces outils construisent des payloads Coinbase valides localement et les enregistrent dans SQLite, mais ne les envoient pas a Coinbase.

Le but pedagogique important : une IA peut aider a structurer un ordre sans avoir le pouvoir de l'envoyer immediatement.

Exemple de logique :

1. l'utilisateur demande une idee d'ordre ;
2. l'IA prepare un dry-run ;
3. le dry-run contient le payload exact ;
4. l'utilisateur inspecte et valide ;
5. seulement ensuite une execution reelle peut etre demandee.

## Execution et annulation reelles

Une execution reelle exige :

- `COINBASE_TRADING_ENABLED=true` ;
- un `dryRunId` ou `proposalId` existant ;
- `confirmationText` exactement egal a `CONFIRM_EXECUTE_ORDER`.

Une annulation reelle exige :

- `COINBASE_TRADING_ENABLED=true` ;
- l'id d'un ordre Coinbase ;
- `confirmationText` exactement egal a `CONFIRM_CANCEL_ORDER`.

Le mot "go" n'est jamais suffisant pour executer ou annuler. Cette regle a ete appliquee en pratique pendant le developpement : lorsque l'utilisateur disait "go", l'assistant devait demander la phrase exacte.

Chaque execution ou annulation est audittee localement.

## Audit SQLite

SQLite conserve :

- les propositions d'ordres ;
- les dry-runs ;
- les executions ;
- les annulations ;
- les evenements de paper trading ;
- les ajouts de sources de connaissance.

Cette base permet de reconstruire ce que l'IA a propose, ce qui a ete envoye, ce que Coinbase a repondu, et quelles actions ont ete confirmees.

Le fichier par defaut est :

```text
data/audit.sqlite
```

Il s'agit d'un etat runtime local, pas d'un fichier a publier.

## Paper trading

Le paper trading a ete ajoute recemment.

Il permet de repeter le meme workflow que le trading reel, mais sans appeler Coinbase pour l'execution. Les ordres sont simules et audites.

Caracteristiques :

- active par `PAPER_TRADING_ENABLED=true` ;
- prend le dessus sur le trading live si les deux sont actives ;
- exige quand meme les confirmations ;
- peut etre alimente par un portefeuille simule ;
- `process_paper_orders` evalue les ordres en attente contre les prix live ;
- `reset_paper_portfolio` remet a zero apres `CONFIRM_RESET_PAPER`.

Limite importante : ce n'est pas un backtest. La simulation ne modelise pas correctement le carnet d'ordres, les slippages, les fills partiels ou toute la complexite des brackets.

## Risk limits

Un module optionnel de limite de risque a ete ajoute.

Il peut bloquer une execution reelle avant envoi a Coinbase si le notional execute sur la journee UTC depasse une limite configuree.

Variables :

```text
RISK_LIMITS_ENABLED=true
MAX_DAILY_NOTIONAL=500
```

Ce module est desactive par defaut. Il ne cherche pas a juger si un ordre est "bon" ou "mauvais". Il applique uniquement une contrainte technique definie par l'utilisateur.

## Knowledge base : registre de sources

Un developpement recent ajoute un registre de sources validees par l'utilisateur.

Fichiers :

```text
knowledge/sources.example.json
knowledge/sources.json
src/services/knowledgeService.ts
src/tools/getKnowledgeBase.ts
src/tools/addKnowledgeSource.ts
```

Objectif :

L'utilisateur peut constituer une liste de sources qu'il juge fiables : calendrier macro, dashboard on-chain, principes personnels de risque, documents, liens de reference, etc.

Avant une analyse de marche ou une proposition d'ordres, l'IA doit consulter `get_knowledge_base` pour savoir quelles sources l'utilisateur veut privilegier.

Le projet ne laisse pas l'IA ajouter une source librement. `add_knowledge_source` exige :

```text
CONFIRM_ADD_SOURCE
```

Cela en fait un outil pedagogiquement interessant : on ne se contente pas de demander a une IA d'aller chercher "des sources". On lui donne un mecanisme controle pour utiliser les sources que l'utilisateur a explicitement validees.

Le fichier `knowledge/sources.example.json` est un modele. Le vrai fichier `knowledge/sources.json` est un etat utilisateur et n'a pas vocation a etre publie tel quel.

## Deux-step watcher

Coinbase n'accepte pas toujours les ordres complexes que l'on aimerait exprimer en un seul payload.

Observation concrete du projet :

- les ordres `LIMIT BUY` avec TP/SL attache ont ete acceptes ;
- les ordres `BUY STOP_LIMIT` avec TP/SL attache ont ete refuses par Coinbase avec `PREVIEW_INVALID_ORDER_TYPE_FOR_ATTACHED` ;
- les protections separees en `SELL BRACKET` ont ete acceptees.

Le watcher deux etapes sert donc a gerer ce genre de cas :

1. placer ou surveiller un ordre parent ;
2. attendre que Coinbase confirme un fill ;
3. poser ensuite un ordre de protection sur la taille reellement remplie.

Fichiers :

```text
scripts/two-step-watcher.mjs
scripts/two-step-watcher.config.example.json
docs/TWO_STEP_WATCHER.md
```

Le watcher ecrit son etat et ses logs dans `data/`. Il evite de doubler les protections deja creees.

## PHP guard distant

Un composant separe existe sous :

```text
server/coinbase-guard
```

Ce n'est pas un serveur MCP. C'est un petit programme PHP deployable sur un hebergement web avec cron.

Il sert de garde distant quand l'ordinateur local est eteint.

Il peut :

- verifier uniquement des ordres explicitement listes ;
- annuler certains ordres selon des regles configurees ;
- surveiller des achats parents explicitement listes ;
- poser une protection de secours apres fill ;
- exposer un `status.php` protege par token ;
- envoyer des emails de notification.

Il ne fait pas de retrait, transfert, send ou payout.

Les fichiers sensibles comme `config.local.php` et le dossier `state/` sont proteges par `.htaccess`. Les scripts de deploiement FTP existent, mais les secrets FTP et les tokens ne doivent jamais etre publics.

## Strategie de trading observee pendant le developpement

Le projet a ete teste avec une logique de trading prudente et humaine :

- conserver beaucoup de cash pendant les baisses ;
- utiliser des petits ordres ;
- preferer les brackets et stops ;
- eviter les achats de marche en panique ;
- utiliser des achats bas avec TP/SL ;
- utiliser des stop-limit de reprise si le marche rebondit ;
- classer certains petits tickets comme purement speculatifs ;
- accepter que certains tickets soient stoppes rapidement.

Cette partie est importante pour un cours : le projet ne promet pas de gagner. Il montre plutot comment une IA peut structurer, suivre, documenter et securiser un processus de decision.

Exemple reel de lecon technique :

Un plan de rachat automatique avec `BUY STOP_LIMIT` et TP/SL attache semblait logique, mais Coinbase l'a refuse. Il a donc fallu comprendre la contrainte API et envisager un workflow en deux etapes. C'est un bon exemple de difference entre une intention strategique et ce que l'API accepte techniquement.

## Securite : principes a expliquer dans un cours

Les points de securite les plus importants :

1. Aucun retrait ni transfert n'est implemente.
2. Le trading live est desactive par defaut.
3. Une execution exige une proposition ou un dry-run preexistant.
4. Une execution exige `CONFIRM_EXECUTE_ORDER`.
5. Une annulation exige `CONFIRM_CANCEL_ORDER`.
6. Les secrets sont rediges avant logs et retours.
7. Les actions sont auditees.
8. Le mode paper permet de repeter le workflow sans argent reel.
9. Le registre de sources evite que l'IA s'appuie uniquement sur des sources non controlees.
10. Les limites du broker et de l'API sont traitees comme des contraintes reelles, pas comme des details.

## Tests et qualite

Le projet contient des tests Vitest pour :

- l'authentification Coinbase ;
- le client Coinbase ;
- les services de portefeuille ;
- l'allocation ;
- la validation d'ordres ;
- les propositions d'ordres ;
- l'execution ;
- l'audit ;
- le paper trading ;
- les risk limits ;
- le knowledge service.

Commandes :

```bash
npm run build
npm test
npm run lint
```

Au moment de la mise a jour de ce document, les controles passaient avec 54 tests.

## Etat des developpements recents

Commits deja presents :

- release initiale du serveur MCP Coinbase ;
- ajout de tests Coinbase auth/client ;
- ajout de la licence MIT ;
- ajout du paper trading audite ;
- ajout du risk limit quotidien ;
- ajout du guide d'onboarding IA.

Developpement en cours visible dans le workspace :

- registre de sources `knowledge/` ;
- `KnowledgeService` ;
- outils `get_knowledge_base` et `add_knowledge_source` ;
- variable `KNOWLEDGE_SOURCES_PATH` ;
- integration de cette knowledge base dans le status serveur et les instructions MCP.

Ce developpement vise a enrichir la qualite des analyses futures en donnant a l'IA une base de sources validees par l'utilisateur.

## Limites du projet

Le projet reste experimental.

Limites importantes :

- il ne donne pas de conseil financier ;
- il ne garantit pas qu'une strategie gagne ;
- il depend des contraintes et erreurs possibles de l'API Coinbase ;
- certains actifs peuvent etre visibles dans le portefeuille mais non tradables directement ;
- certains ordres acceptes en dry-run local peuvent etre refuses par Coinbase ;
- le paper trading simplifie la realite ;
- le PHP guard est un filet de securite minimal, pas une plateforme de trading complete ;
- les donnees de marche et le portefeuille changent constamment.

## Angle possible pour un cours

Un cours peut presenter ce projet comme une etude de cas sur :

- l'integration d'une IA avec une API financiere ;
- le protocole MCP comme interface entre une IA et un outil local ;
- la difference entre lecture, simulation, preparation et execution ;
- la securisation d'actions dangereuses par confirmations explicites ;
- l'audit local des decisions ;
- les contraintes reelles des APIs de trading ;
- le passage d'un prompt naturel a un payload d'ordre structure ;
- l'importance de separer strategie, validation technique et responsabilite utilisateur.

Le message central : ce projet ne rend pas une IA "autonome" sur un compte financier. Il montre comment encadrer une IA pour qu'elle aide a analyser et preparer des actions, tout en gardant l'utilisateur au centre de la decision.
