---
type: Reference
title: Guia completo de uso (pt-BR)
description: Client-facing complete usage guide for the security-scan CLI, Brazilian Portuguese translation.
tags: [guide, usage, pt-br]
timestamp: 2026-07-06T00:00:00Z
---

# security-scan — Guia Completo de Uso

> Versão 0.1.9 | Docker obrigatório (Node.js ≥ 26 apenas para instalação via npm)

---

## Começando em 30 segundos

> **Docker obrigatório** — nenhuma outra dependência de runtime precisa ser instalada localmente.

```bash
# Primeira vez no projeto:
nvm use                        # ativar Node.js correto (.nvmrc)
npm install -g security-scan   # instalar a CLI
security-scan init             # gerar security-scan.config.json (só na primeira vez)

# A partir daí, nas próximas execuções basta:
security-scan fix              # scan + correções + relatório
```

---

## Sumário

1. [Visão Geral](#visão-geral)
2. [Requisitos](#requisitos)
3. [Instalação](#instalação)
4. [Início Rápido](#início-rápido)
5. [Comandos](#comandos)
   - [init](#init)
   - [scan](#scan)
   - [fix](#fix)
   - [executive-report](#executive-report)
6. [Referência de Configuração](#referência-de-configuração)
   - [project](#project)
   - [report_language](#report_language)
   - [ecosystems](#ecosystems)
   - [protected_packages](#protected_packages)
   - [safe_update_policy](#safe_update_policy)
   - [scanners](#scanners)
   - [runners](#runners)
   - [scan (caminhos de varredura)](#scan-caminhos-de-varredura)
   - [outputs](#outputs)
7. [Docker e Estratégias de Runtime](#docker-e-estratégias-de-runtime)
8. [Engines de Scanner](#engines-de-scanner)
   - [OSV Scanner](#osv-scanner)
   - [SonarQube](#sonarqube)
9. [Plugins de Ecossistema e Estratégias de Fix](#plugins-de-ecossistema-e-estratégias-de-fix)
10. [Pacotes Protegidos e Política de Atualização Segura](#pacotes-protegidos-e-política-de-atualização-segura)
11. [Variáveis de Ambiente](#variáveis-de-ambiente)
12. [Códigos de Saída](#códigos-de-saída)
13. [O que fazer depois do `fix`](#o-que-fazer-depois-do-fix)
14. [Solução de Problemas](#solução-de-problemas)
15. [Perguntas Frequentes](#perguntas-frequentes)

---

## Visão Geral

`security-scan` é uma ferramenta de linha de comando que automatiza o fluxo completo de gerenciamento de vulnerabilidades em projetos com múltiplos ecossistemas. Com um único comando, ela é capaz de:

1. Varrer todos os lockfiles (`composer.lock`, `package-lock.json`, `requirements.txt`, `Pipfile.lock`) usando o [OSV Scanner](https://google.github.io/osv-scanner/)
2. Classificar as vulnerabilidades como seguras para atualizar ou como atualizações que precisam de autorização manual
3. Aplicar atualizações de patch e minor dentro de containers Docker isolados — não é necessário ter PHP, Node.js ou Python instalados localmente
4. Executar os comandos de validação (suíte de testes) dentro do mesmo container para confirmar que nada quebrou
5. Reverter todas as alterações automaticamente caso a validação falhe
6. Gerar um relatório executivo em HTML com comparação de vulnerabilidades antes e depois das correções

Mudanças disruptivas (bumps de versão major, alterações de constraint) nunca são aplicadas automaticamente. Elas exigem autorização explícita por ecossistema via `--authorize-breaking`.

---

## Requisitos

| Ferramenta | Versão mínima | Observação |
|------------|--------------|------------|
| Docker     | qualquer recente | **Obrigatório.** Todos os runtimes de ecossistema e scanners rodam em containers. |
| Node.js    | ≥ 26.0.0     | **Obrigatório.** Use `nvm use` para ativar a versão correta (o projeto inclui `.nvmrc`). |

Docker é o único requisito de runtime obrigatório. OSV Scanner, SonarQube, npm, PHP Composer e pip rodam todos dentro de containers Docker efêmeros. Não é necessário instalar nenhuma dessas ferramentas localmente.

---

## Instalação

### Pré-requisito: Node.js ≥ 26 via nvm

O projeto inclui um arquivo `.nvmrc` que fixa a versão correta. Antes de instalar ou executar o security-scan, garanta que está usando a versão certa:

```bash
# Instalar a versão se ainda não tiver
nvm install

# Ativar a versão (execute sempre que abrir um terminal novo no projeto)
nvm use
```

> **Dica:** para ativar automaticamente ao entrar no diretório, adicione o [auto-use do nvm](https://github.com/nvm-sh/nvm#deeper-shell-integration) ao seu `.bashrc` ou `.zshrc`. Assim você nunca esquece de rodar `nvm use`.

### Instalar via npm

```bash
npm install -g security-scan
```

### Verificar a instalação

```bash
node --version
# v26.x.x (confirme que é ≥ 26)

security-scan --version
# security-scan/0.1.9
```

---

## Início Rápido

### Primeira vez no projeto (setup)

**Passo 1: Gerar o arquivo de configuração**

```bash
security-scan init
```

Isso inicia um assistente interativo que detecta seus ecossistemas (npm, composer, pip), solicita que você confirme ou ajuste a configuração e grava um `security-scan.config.json` no diretório atual.

> **Esse passo é feito apenas uma vez.** O `security-scan.config.json` gerado é commitado no repositório. Nas próximas execuções, pule direto para o passo 2.

### Uso recorrente

**Passo 2: Varrer por vulnerabilidades**

```bash
security-scan scan
```

Exibe um resumo de todas as vulnerabilidades encontradas. Nenhum arquivo é modificado.

**Passo 3: Aplicar correções seguras**

```bash
security-scan fix
```

Executa o pipeline completo: scan → aplicar atualizações seguras → validar → reverter se quebrar → gerar relatório executivo.

> **Rotina típica:** se o projeto já tem `security-scan.config.json`, o fluxo do dia a dia é apenas `security-scan fix`.

---

## Comandos

### `init`

Gera um template de `security-scan.config.json` para o projeto atual.

```
security-scan init [options]
```

| Opção | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `--project-name <name>` | string | prompt interativo | Nome do projeto gravado na configuração |
| `--client <name>` | string | prompt interativo | Nome do cliente gravado na configuração |
| `--cwd <path>` | string | diretório atual | Diretório de trabalho para detecção de ecossistemas |
| `--output <path>` | string | `./security-scan.config.json` | Caminho do arquivo de saída |
| `--force` | boolean | `false` | Sobrescrever o arquivo se ele já existir |

**O que acontece durante o `init`:**

1. Verifica se `security-scan.config.json` já existe (falha a menos que `--force` esteja ativo).
2. Solicita o nome do projeto e do cliente (ou usa as flags da CLI).
3. Varre recursivamente a árvore do projeto em busca de lockfiles (`package-lock.json`, `composer.lock`, `requirements.txt`, `Pipfile.lock`) e Dockerfiles declarados por cada plugin de ecossistema, usando `discoverProject()`. Cada lockfile encontrado se torna uma entrada candidata de ecossistema, com o caminho do subdiretório registrado.
4. **Resumo da descoberta:** quando qualquer ecossistema é encontrado em um subdiretório (layout de monorepo), exibe um resumo formatado antes do checkbox — por exemplo:
   ```
   Found 3 ecosystem(s):
     npm         package-lock.json       frontend/
     npm         package-lock.json       backend/
     composer    composer.lock           (root)
   ```
   Descobertas apenas na raiz são silenciosas (sem resumo exibido).
5. Apresenta um seletor de ecossistemas com checkbox. Cada entrada é rotulada com o tipo de ecossistema, o nome do lockfile e o caminho do subdiretório (ex.: `npm — package-lock.json (web/)`). Os ecossistemas detectados vêm pré-selecionados.
6. Quando dois ou mais entries compartilham o mesmo id de ecossistema (ex.: dois entries `npm` em um monorepo), solicita um `label` distinto para cada um (ex.: `frontend`, `backend`). Os labels são usados para distinguir os entries em relatórios e na saída da CLI.
7. Para cada ecossistema, solicita:
   - Estratégia de fix (`osv`, `npm-audit`, `osv-then-audit`)
   - Comandos de validação (ex.: `npm test`, `php artisan test`)
   - Comandos de advisor (ex.: `npm audit --json`)
   - Versão do runtime (inferida a partir do subdiretório do ecossistema ou digitada manualmente)
   - Modo de build (pull ou build a partir do Dockerfile)
8. Pergunta se deve ativar a integração com SonarQube.
9. Pergunta o idioma dos relatórios (`en` ou `pt-br`).
10. Pergunta se deve gerar relatórios Markdown e onde salvá-los.
11. Grava o `security-scan.config.json` gerado.
12. Se SonarQube estiver ativo e `sonar-project.properties` não existir, cria um template inicial.

**Exemplo — modo não interativo (amigável para CI):**

```bash
security-scan init \
  --project-name "Meu App" \
  --client "Acme Corp" \
  --force
```

No modo não interativo (quando stdin não é um TTY), o `init` seleciona automaticamente todos os ecossistemas detectados e seus valores padrão.

**Códigos de saída:** `0` sucesso, `3` erro de configuração ou de saída.

---

### `scan`

Executa apenas a varredura de vulnerabilidades. Nenhum arquivo é modificado.

```
security-scan scan [options]
```

| Opção | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `-c, --config <path>` | string | `./security-scan.config.json` | Caminho para o arquivo de configuração |
| `--cwd <path>` | string | diretório atual | Diretório de trabalho (raiz do projeto) |
| `--dry-run` | boolean | `false` | Exibir o que seria executado, sem executar nada |
| `-v, --verbose` | boolean | `false` | Ativar saída verbosa |
| `-q, --quiet` | boolean | `false` | Suprimir toda saída exceto erros e o relatório final |
| `--json` | boolean | `false` | Exibir resultado em JSON no stdout |
| `-o, --output <path>` | string | stdout | Gravar saída em um arquivo |

**O que acontece durante o `scan`:**

1. Carrega e valida o `security-scan.config.json` usando o schema Zod. Sai com código `3` em caso de erro de validação.
2. Executa o `osv-scanner` dentro de um container Docker efêmero contra todos os lockfiles detectados no diretório de trabalho.
3. Analisa a saída do OSV e classifica cada resultado:
   - `auto_safe` — atualização de patch/minor dentro das constraints atuais
   - `breaking` — requer bump de versão major ou mudança de constraint
4. Formata e emite o resultado (resumo em texto ou JSON).

**Exemplos:**

```bash
# Varredura básica
security-scan scan

# Varrer um projeto em outro diretório
security-scan scan --cwd /caminho/para/o/projeto

# Salvar resultados em JSON (útil como artefato de CI)
security-scan scan --json --output scan-results.json

# Modo silencioso: exibir apenas o resumo final
security-scan scan --quiet
```

**Exemplo de saída:**

```
security-scan scan summary
========================
npm        2 vulnerabilities  (1 auto-safe, 1 breaking)
composer   0 vulnerabilities
pip        1 vulnerability    (1 auto-safe)

Exit code: 1 (breaking vulnerabilities found)
```

**Códigos de saída:**

| Código | Significado |
|--------|-------------|
| `0` | Nenhuma vulnerabilidade encontrada |
| `1` | Vulnerabilidades disruptivas encontradas |
| `2` | Erro no scanner (falha no gate ou erro do OSV) |
| `3` | Erro de configuração |

---

### `fix`

Pipeline completo: scan → aplicar atualizações seguras por ecossistema → validar → reverter se quebrar → gerar relatório executivo.

```
security-scan fix [options]
```

| Opção | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `-c, --config <path>` | string | `./security-scan.config.json` | Caminho para o arquivo de configuração |
| `--cwd <path>` | string | diretório atual | Diretório de trabalho (raiz do projeto) |
| `--phases <phases>` | string | todas as fases | Lista de fases separadas por vírgula. Aceita `scan`, `npm`, `composer`, `pip`, `report`. Também aceita entry keys para targeting em monorepos: `npm:frontend` executa apenas aquela entrada; `npm` executa todas as entradas npm. |
| `--no-report` | boolean | `false` | Não gerar o relatório executivo |
| `--authorize-breaking <id...>` | string[] | nenhum | Autorizar atualizações disruptivas para os ecossistemas especificados. Aceita id de plugin simples (`npm`) ou entry key (`npm:frontend`). Um id simples autoriza todas as entradas com aquele plugin. Exemplo: `--authorize-breaking composer npm:frontend` |
| `--split-reports` | boolean | `false` | Gerar um relatório HTML por entrada de ecossistema em vez de um relatório consolidado. Sobrescreve `outputs.split_reports` no config. |
| `--dry-run` | boolean | `false` | Registrar as mudanças planejadas sem executar nada |
| `-v, --verbose` | boolean | `false` | Ativar saída verbosa |
| `-q, --quiet` | boolean | `false` | Suprimir toda saída exceto erros e o relatório final |
| `--json` | boolean | `false` | Exibir resultado em JSON |
| `-o, --output <path>` | string | stdout | Gravar relatório em arquivo |
**Fases do pipeline:**

O comando `fix` executa as seguintes fases em ordem:

1. **scan** — executa o OSV Scanner como Gate A; classifica as vulnerabilidades.
2. **npm** — atualiza pacotes npm (se o ecossistema npm estiver configurado).
3. **composer** — atualiza pacotes PHP (se o ecossistema composer estiver configurado).
4. **pip** — atualiza pacotes Python (se o ecossistema pip estiver configurado).
5. **report** — gera o relatório executivo em HTML.

Use `--phases` para executar apenas um subconjunto:

```bash
# Executar somente as fases scan e npm
security-scan fix --phases scan,npm

# Executar todas as fases exceto o relatório
security-scan fix --no-report
```

**Autorizando mudanças disruptivas:**

```bash
# Permitir que pacotes do composer sejam atualizados para versões disruptivas
security-scan fix --authorize-breaking composer

# Permitir atualizações disruptivas em npm e composer
security-scan fix --authorize-breaking npm composer

# Monorepo: autorizar apenas a entrada npm do frontend (não o backend)
security-scan fix --authorize-breaking npm:frontend
```

A autorização é por execução e nunca é persistida no arquivo de configuração.

**Targeting de entradas específicas em monorepo:**

```bash
# Executar apenas scan e a entrada npm do frontend
security-scan fix --phases scan,npm:frontend,report

# Executar scan e todas as entradas npm (qualquer label)
security-scan fix --phases scan,npm,report
```

**Gerando split reports (um por entrada):**

```bash
# Gerar relatórios HTML separados para cada entrada de ecossistema
security-scan fix --split-reports
```

Com um config de monorepo contendo `npm (label: frontend)`, `npm (label: backend)` e `composer`, isso produz:
- `npm-frontend-report.html`
- `npm-backend-report.html`
- `composer-report.html`

Como alternativa, defina `outputs.split_reports: true` no config para tornar esse comportamento o padrão. A flag da CLI sempre tem precedência.

**Variável de ambiente kill-switch:**

```bash
# Pular todas as correções automáticas após a fase de scan
SECURITY_SCAN_NO_AUTO_FIX=1 security-scan fix
```

Útil em pipelines de CI onde você quer o resultado do scan registrado, mas sem mutações em arquivos.

**Códigos de saída:**

| Código | Significado |
|--------|-------------|
| `0` | Tudo resolvido (ou nada a corrigir) |
| `1` | Vulnerabilidades encontradas / erros de atualização / vulnerabilidades pendentes restantes |
| `2` | Falha no gate ou erro no scanner |
| `3` | Erro de configuração |

**Detalhe do pipeline por ecossistema:**

Para cada entry em `config.ecosystems` (na ordem de declaração):
1. Executa advisors (apenas informativos — nunca bloqueiam o pipeline).
2. Pula o entry se não houver vulnerabilidades `auto_safe` (e nenhuma `breaking` com `--authorize-breaking`).
3. Resolve o runner de container Docker para este entry (npm/pip/composer), usando a configuração inline de `runner` do entry.
4. Para npm: auto-rebaixa a estratégia `osv`/`osv-then-audit` para `npm-audit` se o `package-lock.json` tiver `lockfileVersion: 1` (o osv-scanner não consegue corrigir lockfiles v1 in-place).
5. Chama o updater do plugin.
6. Opcionalmente instala pacotes disruptivos (`--authorize-breaking`).
7. Executa verificação residual do OSV pós-atualização para confirmar que as correções foram aplicadas.
8. Valida o resultado da atualização contra o gate do ecossistema (schema Zod).

Em caso de sucesso: aplica as atualizações e executa os comandos de validação.
Em caso de falha na validação: reverte todas as mudanças naquele ecossistema e continua com os demais.

---

### `executive-report`

Gera um relatório executivo em HTML a partir dos últimos resultados de varredura.

```
security-scan executive-report [options]
```

| Opção | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `-c, --config <path>` | string | `./security-scan.config.json` | Caminho para o arquivo de configuração |
| `--cwd <path>` | string | diretório atual | Diretório de trabalho |
| `--client <name>` | string | da configuração | Nome do cliente (sobrescreve `project.client` na configuração) |
| `--project <name>` | string | da configuração | Nome do projeto (sobrescreve `project.name` na configuração) |
| `-o, --output <path>` | string | diretório de relatórios | Gravar relatório em arquivo |
| `--split-reports` | boolean | `false` | Gerar um relatório por entrada de ecossistema. Sobrescreve `outputs.split_reports` no config. |
| `--dry-run` | boolean | `false` | Exibir comandos sem executar |
| `-v, --verbose` | boolean | `false` | Ativar saída verbosa |
| `-q, --quiet` | boolean | `false` | Suprimir toda saída exceto erros e o relatório final |
| `--json` | boolean | `false` | Exibir resultado em JSON |

**O que acontece:**

1. Executa uma varredura de vulnerabilidades atualizada (estado antes).
2. Executa o pipeline completo do orquestrador.
3. Renderiza o relatório executivo em HTML.
4. Salva o relatório no diretório de saída configurado.
O idioma do relatório é controlado por `report_language` no `security-scan.config.json` (`en` ou `pt-br`).

**Exemplo:**

```bash
# Gerar relatório com nome de cliente personalizado
security-scan executive-report --client "Acme Corp" --output relatorio.html
```

---

## Referência de Configuração

O `security-scan.config.json` é a única fonte de verdade para todo o comportamento do security-scan. Abaixo está a referência completa e anotada de todos os campos.

### `project`

```json
{
  "project": {
    "name": "Meu Projeto",
    "client": "Acme Corp"
  }
}
```

### `report_language`

```json
{
  "report_language": "pt-br"
}
```

Controla o locale dos relatórios executivos gerados. Afeta todo o texto dos relatórios HTML e Markdown. Não afeta a saída da CLI.

### `config_version`

```json
{
  "config_version": "1"
}
```

### `ecosystems`

Lista declarativa de ecossistemas a varrer e atualizar. Pelo menos uma entrada é obrigatória.

```json
{
  "ecosystems": [
    {
      "id": "npm",
      "fixer": "osv-then-audit",
      "validationCommands": [
        {
          "name": "Tests",
          "command": "npm test",
          "timeout_seconds": 120
        }
      ],
      "advisors": [
        {
          "name": "audit",
          "command": "npm audit --json",
          "format": "json"
        }
      ]
    },
    {
      "id": "composer",
      "fixer": "osv",
      "validationCommands": [
        {
          "name": "Tests",
          "command": "php artisan test",
          "timeout_seconds": 300
        }
      ],
      "advisors": []
    },
    {
      "id": "pip",
      "fixer": "osv",
      "validationCommands": [
        {
          "name": "Tests",
          "command": "pytest"
        }
      ]
    }
  ]
}
```

**Campos do ecossistema:**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `id` | `npm` \| `composer` \| `pip` | Sim | Identificador do ecossistema |
| `path` | string | Não | Caminho relativo do subdiretório onde o lockfile deste ecossistema está localizado (suporte a monorepo). Sem `/` inicial, `./` ou segmentos `..`. Quando ausente, o ecossistema é tratado como raiz do projeto. |
| `label` | string | Não | Rótulo legível para distinguir múltiplos entries com o mesmo `id` (ex.: `frontend`, `backend`). Obrigatório quando dois ou mais entries compartilham o mesmo `id`. Deve seguir `^[a-z0-9-]+$`. |
| `fixer` | string | Não | Estratégia de fix (veja [Estratégias de Fix](#estratégias-de-fix)) |
| `validationCommands` | array | Não | Comandos executados após as atualizações para verificar que nada quebrou |
| `validationCommands[].name` | string | Sim | Rótulo legível para o comando |
| `validationCommands[].command` | string | Sim | String de comando shell (executado dentro do container Docker) |
| `validationCommands[].timeout_seconds` | number | Não | Timeout em segundos; padrão: 300 |
| `advisors` | array | Não | Comandos informativos executados antes das atualizações (nunca bloqueiam o pipeline) |
| `advisors[].name` | string | Sim | Rótulo legível |
| `advisors[].command` | string | Sim | String de comando shell |
| `advisors[].format` | `json` \| `text` | Não | Formato de saída; use `json` para `npm audit --json` |
| `runner` | object | Não | Configuração inline do runner Docker para este entry de ecossistema (veja [runners](#runners)) |

**Nota de segurança sobre `validationCommands`:** Esses comandos são executados dentro do container Docker do ecossistema via `sh -c`. Não estão expostos a entrada externa — apenas comandos criados no `security-scan.config.json` (que você controla) são executados. Comandos que começam com `git`, `gh` ou `open` são exceções e executam no host.

### `protected_packages`

Pacotes listados aqui nunca são atualizados além da constraint declarada. Qualquer atualização que exija mudança de constraint requer `--authorize-breaking` explícito.

```json
{
  "protected_packages": {
    "npm": [
      {
        "package": "tailwindcss",
        "constraint": "^3.3.3",
        "reason": "Tailwind v4 tem mudanças disruptivas de config e requer migração"
      },
      {
        "package": "react",
        "constraint": "^18.0.0",
        "reason": "Migração para React 19 requer ciclo completo de QA"
      }
    ],
    "composer": [
      {
        "package": "laravel/framework",
        "constraint": "^10.8",
        "reason": "Upgrade major para Laravel 11 requer um projeto dedicado"
      }
    ],
    "pip": [
      {
        "package": "django",
        "constraint": ">=4.2,<5.0",
        "reason": "Django 5.x tem mudanças disruptivas"
      }
    ]
  }
}
```

**Campos por entrada:**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `package` | string | Sim | Nome do pacote como aparece no lockfile |
| `constraint` | string | Sim | A constraint de versão que não deve ser excedida |
| `reason` | string | Sim | Motivo legível (aparece nos relatórios) |

### `safe_update_policy`

```json
{
  "safe_update_policy": {
    "allow_patch_and_minor_within_constraints": true,
    "require_authorization_for_constraint_change": true
  }
}
```

| Campo | Padrão | Descrição |
|-------|--------|-----------|
| `allow_patch_and_minor_within_constraints` | `true` | Aplicar automaticamente atualizações de patch e minor que permaneçam dentro das constraints `^` / `~` / `>=` atuais |
| `require_authorization_for_constraint_change` | `true` | Exigir `--authorize-breaking` para qualquer atualização que mude a constraint de versão declarada |

### `scanners`

Controla quais engines de scanning são usadas e como são configuradas.

```json
{
  "scanners": {
    "primary": "osv",
    "osv": {
      "runner": "docker",
      "image": "ghcr.io/google/osv-scanner:latest",
      "args": []
    },
    "sonarqube": {
      "enabled": false,
      "mode": "external",
      "on_failure": "warn",
      "scanner_image": "sonarsource/sonar-scanner-cli:latest",
      "server_image": "sonarqube:lts-community",
      "send_branch_name": false,
      "ce_task_timeout_seconds": 120,
      "scanner_timeout_seconds": 300,
      "dynamic_timeout": true,
      "timeout_scale": {
        "scanner_seconds_per_kloc": 3,
        "ce_seconds_per_kloc": 1.5
      },
      "scanner_jvm_opts": "-Xmx2048m"
    }
  }
}
```

**Modos do runner OSV:**

| Modo | Comportamento |
|------|---------------|
| `docker` | Sempre executar o osv-scanner via container Docker efêmero. **Padrão e recomendado.** |
| `local` | Usar o binário `osv-scanner` instalado localmente. Falha se não estiver instalado. Emite aviso. |

### `runners`

Configuração de container por ecossistema. Controla qual imagem Docker é usada, a versão do runtime e dependências opcionais de SO. A configuração do runner é declarada **inline em cada entry de ecossistema** usando o campo `runner` — não existe um bloco `runners` separado no nível raiz:

```json
{
  "ecosystems": [
    {
      "id": "npm",
      "path": "frontend",
      "label": "frontend",
      "runner": {
        "language_version": "20",
        "native_deps": ["libvips-dev", "build-essential", "python3"]
      }
    },
    {
      "id": "npm",
      "path": "backend",
      "label": "backend",
      "runner": {
        "language_version": "20"
      }
    },
    {
      "id": "composer",
      "runner": {
        "language_version": "8.1",
        "native_deps": ["imagemagick", "libmagickwand-dev"]
      }
    },
    {
      "id": "pip",
      "runner": {
        "language_version": "3.11",
        "native_deps": ["libjpeg-dev", "libpq-dev"]
      }
    }
  ]
}
```

Todos os runners executam dentro de containers Docker efêmeros. Não existe modo `local` para runners de ecossistema — essa opção existe apenas para o scanner OSV (`scanners.osv.runner`).

### `scan` (caminhos de varredura)

Controla quais caminhos o `osv-scanner` inspeciona.

```json
{
  "scan": {
    "auto_discover": true,
    "paths": [
      "frontend/",
      "backend/package-lock.json"
    ],
    "exclude": [
      "vendor/",
      "node_modules/"
    ]
  }
}
```

**Restrições sobre paths:** Todas as entradas devem ser relativas (sem `/` inicial) e não devem conter segmentos `..` ou caracteres glob. Os caminhos se resolvem em relação a `/project` dentro do container.

### `outputs`

Controla o local e os formatos dos relatórios.

```json
{
  "outputs": {
    "dir": "./reports",
    "sub_folders": false,
    "formats": ["markdown"],
    "split_reports": false
  }
}
```

O relatório executivo em HTML sempre é gerado. Markdown e DOCX só são gerados quando incluídos em `formats`.

| Campo | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `dir` | string | `./reports` | Diretório onde os relatórios são gravados |
| `sub_folders` | boolean | `false` | Quando true, relatórios específicos de engine (ex.: SonarQube) vão para sub-pastas |
| `formats` | string[] | `[]` | Formatos adicionais de relatório a gerar (`markdown`, `docx`) |
| `split_reports` | boolean | `false` | Quando true, gera um relatório HTML por entrada de ecossistema em vez de um consolidado. A flag `--split-reports` da CLI tem precedência sobre este valor. |

---

## Docker e Estratégias de Runtime

Todos os CLIs de ecossistema (npm, composer, pip) e os scanners (osv-scanner) executam dentro de containers Docker efêmeros por padrão. Isso significa:

- Não é necessário ter Node.js, PHP ou Python instalados localmente além do próprio CLI do security-scan.
- Cada execução obtém um ambiente limpo e isolado.
- As versões dos containers correspondem ao runtime declarado do projeto (inferido ou configurado).
- Os containers são removidos automaticamente após cada execução (`--rm`).

### Resolução de Imagem: pull vs build

Cada runner suporta duas estratégias de imagem:

**`pull` (padrão):** Baixar uma imagem pré-construída do Docker Hub ou outro registry. Nenhum campo `build` é necessário — basta definir `language_version` ou depender da inferência.

```json
{
  "ecosystems": [
    {
      "id": "npm",
      "runner": {
        "language_version": "20"
      }
    }
  ]
}
```

**`build`:** Construir uma imagem local a partir de um Dockerfile do próprio projeto. Use quando o projeto tem dependências de sistema não padrão ou uma imagem base personalizada.

```json
{
  "ecosystems": [
    {
      "id": "npm",
      "runner": {
        "build": {
          "dockerfile": ".docker/node.Dockerfile",
          "context": ".",
          "args": {
            "NODE_VERSION": "20",
            "APP_ENV": "production"
          }
        }
      }
    }
  ]
}
```

**Coexistência de `image` + `build`:** É possível combinar `image` e `build` para construir e marcar com um nome personalizado.

```json
{
  "ecosystems": [
    {
      "id": "npm",
      "runner": {
        "image": "myapp:latest",
        "build": {
          "dockerfile": "Dockerfile",
          "target": "node-stage"
        }
      }
    }
  ]
}
```

**Estágios multi-stage:** Use `build.target` para selecionar um estágio específico de um Dockerfile multi-stage. Múltiplos ecossistemas que compartilham o mesmo `dockerfile`, `context`, `target` e `args` recebem automaticamente a mesma tag de imagem (deduplicação por hash de conteúdo) — sem rebuilds redundantes.

Quando `build.allow_context_escape: true`, o contexto de build pode alcançar fora da raiz do projeto — isso emite um aviso porque envia uma árvore de diretórios maior para o daemon Docker.

### Resolução de Versão do Runtime

Quando `image` não está definido e nenhum campo `build` está presente, o runner resolve a imagem Docker a partir da versão do runtime usando esta precedência:

**npm:**
1. `ecosystems[].runner.language_version` da configuração (ex.: `'20'` → `node:20`)
2. Inferido de `.nvmrc` / `.node-version` / `package.json#engines.node`
3. Recorre a `node:lts`

**composer:**
1. `ecosystems[].runner.language_version` da configuração (ex.: `'8.2'` → `php:8.2-cli`)
2. Inferido de `.php-version` / `composer.json#require.php`
3. Recorre a `composer:2`

**pip:**
1. `ecosystems[].runner.language_version` da configuração (ex.: `'3.11'` → `python:3.11-slim`)
2. Inferido de `runtime.txt` / `.python-version`
3. Recorre a `python:3-slim`

### Dependências Nativas de SO

Alguns pacotes npm (ex.: `sharp`, `canvas`) ou extensões PHP (ex.: `imagick`) requerem bibliotecas de SO para compilar. Use `native_deps` para instalá-las via `apt-get` dentro do container efêmero:

```json
{
  "ecosystems": [
    {
      "id": "npm",
      "runner": {
        "native_deps": ["libvips-dev", "build-essential", "python3"]
      }
    },
    {
      "id": "composer",
      "runner": {
        "native_deps": ["imagemagick", "libmagickwand-dev"]
      }
    },
    {
      "id": "pip",
      "runner": {
        "native_deps": ["libjpeg-dev", "libpq-dev"]
      }
    }
  ]
}
```

Os pacotes são instalados com `apt-get install -y --no-install-recommends` antes do CLI do ecossistema executar. Os nomes de pacotes devem seguir as convenções de nomenclatura Debian (alfanumérico minúsculo, hífens, pontos e sinais de adição apenas).

---

## Engines de Scanner

### OSV Scanner

A engine de scanning primária. O OSV Scanner usa o banco de dados [Open Source Vulnerabilities](https://osv.dev) do Google para encontrar vulnerabilidades conhecidas em lockfiles.

**Lockfiles suportados:**
- `package-lock.json` (npm)
- `yarn.lock` (npm, apenas leitura — atualizações via npm)
- `composer.lock` (PHP Composer)
- `requirements.txt`, `Pipfile.lock` (Python pip)

**Configuração:**

```json
{
  "scanners": {
    "primary": "osv",
    "osv": {
      "runner": "docker",
      "image": "ghcr.io/google/osv-scanner:latest",
      "args": ["--experimental-call-analysis"]
    }
  }
}
```

O OSV Scanner executa em um container Docker efêmero. O diretório do projeto é montado como somente leitura dentro do container. Nenhum lockfile é modificado durante a fase de scan.

### SonarQube

Uma engine de scanning secundária opcional para análise de qualidade de código.

**Modo external** (padrão quando ativado):

Usa uma instância SonarQube pré-existente. A configuração vem de `sonar-project.properties` na raiz do projeto. A autenticação usa a variável de ambiente `SONAR_TOKEN`.

```json
{
  "scanners": {
    "sonarqube": {
      "enabled": true,
      "mode": "external",
      "on_failure": "warn"
    }
  }
}
```

Crie o arquivo `sonar-project.properties`:

```properties
sonar.projectKey=meu-projeto
sonar.projectName=Meu Projeto
sonar.sources=src
sonar.exclusions=**/node_modules/**,**/vendor/**
sonar.host.url=https://sonarqube.exemplo.com
```

Defina o token de autenticação:

```bash
export SONAR_TOKEN=seu_token_aqui
```

**Gerando um token no SonarQube:**

Acesse sua instância SonarQube → **Ícone do usuário (canto superior direito) → My Account → Security → Generate Tokens**.

| Tipo de token | Prefixo | Submete análise | Consulta API (CE task, Quality Gate, métricas) |
|---|---|---|---|
| **User Token** | `squ_` | Sim | Sim (herda as permissões do usuário) |
| Project Analysis Token | `sqp_` | Sim | Não (somente análise) |
| Global Analysis Token | `sqa_` | Sim | Não (somente análise) |

**Use um User Token** (`squ_`). Tokens do tipo Project e Global Analysis podem submeter scans, mas não conseguem consultar as APIs de Compute Engine ou Quality Gate — você verá erros HTTP 403 durante a fase pós-scan.

O usuário associado ao token precisa ter permissão **Browse** no projeto (concedida por padrão para membros do projeto) ou **Administer System** globalmente.

> **Importante:** Não armazene o token no `sonar-project.properties`. Os campos `sonar.login` e `sonar.password` são deprecated (sonar-scanner 5+ os rejeita). Sempre use a variável de ambiente `SONAR_TOKEN`. Em CI, adicione-o como secret do ambiente.

**Modo managed:**

A CLI provisiona um container SonarQube Community Edition efêmero, executa o scan e depois o derruba.

```json
{
  "scanners": {
    "sonarqube": {
      "enabled": true,
      "mode": "managed",
      "server_image": "sonarqube:lts-community",
      "scanner_image": "sonarsource/sonar-scanner-cli:latest",
      "on_failure": "warn"
    }
  }
}
```

Nota: `send_branch_name: true` requer SonarQube Developer Edition ou superior. Community Edition não suporta análise de branches.

**Resultados do SonarQube nos relatórios:**

Quando o SonarQube está ativo, o relatório executivo inclui:
- Status do Quality Gate (PASSED / FAILED)
- Condições do Quality Gate
- Métricas: bugs, vulnerabilidades, code smells, cobertura, linhas duplicadas, NCLOC
- Issues por arquivo

---

## Plugins de Ecossistema e Estratégias de Fix

### npm

Varre `package-lock.json` e aplica atualizações de dependências npm.

**Estratégias de fix:**

| Estratégia | Comportamento |
|------------|---------------|
| `osv` | O OSV Scanner aplica correções in-place ao `package-lock.json`. Mudanças disruptivas são aplicadas separadamente pelo npm via `npm install <pkg>@<version>`. |
| `npm-audit` | Usa `npm audit fix` exclusivamente. O fix do OSV não é executado neste caminho. |
| `osv-then-audit` | Aplica o fix do OSV primeiro, depois executa `npm audit fix` em cima. Se a validação falhar após ambos, reverte a porção do `npm-audit` e revalida contra o estado somente-OSV. **Padrão para npm.** |

**Auto-rebaixamento:**

Se o `package-lock.json` tiver `lockfileVersion: 1` (npm ≤ 6), as estratégias `osv` e `osv-then-audit` são automaticamente rebaixadas para `npm-audit` porque o osv-scanner não consegue corrigir lockfiles v1 in-place. Esse rebaixamento é registrado como aviso.

### composer

Varre `composer.lock` e aplica atualizações de pacotes PHP usando o Composer.

**Estratégia de fix:**

| Estratégia | Comportamento |
|------------|---------------|
| `osv` | O OSV Scanner identifica pacotes vulneráveis; o Composer é usado para atualizá-los. **Única estratégia disponível para composer.** |

**Imagem padrão:** `php:<versão>-cli` (ex.: `php:8.2-cli`)

**Requisitos de plataforma:** A CLI ignora automaticamente requisitos de plataforma irrelevantes (extensões PHP específicas do ambiente de produção) ao executar dentro de containers Docker, usando flags granulares `--ignore-platform-req` por extensão. Nenhuma configuração manual é necessária.

### pip

Varre `requirements.txt` ou `Pipfile.lock` e aplica atualizações de pacotes Python usando pip.

**Estratégia de fix:**

| Estratégia | Comportamento |
|------------|---------------|
| `osv` | O OSV Scanner identifica pacotes vulneráveis; o pip é usado para atualizá-los. **Única estratégia disponível para pip.** |

**Imagem padrão:** `python:<versão>-slim` (ex.: `python:3.11-slim`)

### Estratégias de Fix

| Estratégia | Ecossistemas | Descrição |
|------------|--------------|-----------|
| `osv` | npm, composer, pip | O OSV Scanner realiza correções in-place nos lockfiles. É o método mais preciso — as correções são retiradas diretamente do banco de dados OSV. |
| `npm-audit` | apenas npm | Delega o fix ao `npm audit fix`. Mais rápido, mas menos preciso que o OSV para árvores de dependência complexas. |
| `osv-then-audit` | apenas npm | Aplica o fix do OSV primeiro para precisão, depois executa `npm audit fix` para capturar problemas restantes. Recua graciosamente para somente-OSV se o audit-fix causar falhas na validação. |

---

## Pacotes Protegidos e Política de Atualização Segura

Os mecanismos de pacotes protegidos e de política de atualização segura trabalham juntos para prevenir mudanças disruptivas acidentais.

### Como a Proteção Funciona

1. Quando uma vulnerabilidade é encontrada em um pacote protegido:
   - Se o fix permanece dentro da `constraint` declarada, é classificado como `auto_safe` e aplicado normalmente.
   - Se o fix requer exceder a `constraint` (ex.: `^3.x` → `^4.x`), é classificado como `breaking` e ignorado.

2. Vulnerabilidades `breaking` são reportadas no relatório executivo com o motivo de por que não foram corrigidas.

3. Para aplicar uma atualização disruptiva a um pacote protegido:
   ```bash
   security-scan fix --authorize-breaking npm
   ```
   Isso autoriza todas as atualizações disruptivas para npm nesta execução. A autorização não é persistida.

### Regras da Política de Atualização Segura

```json
{
  "safe_update_policy": {
    "allow_patch_and_minor_within_constraints": true,
    "require_authorization_for_constraint_change": true
  }
}
```

Com os padrões acima:
- `lodash@4.17.19` → `lodash@4.17.21` (patch dentro de `^4.17.0`) → **aplicado automaticamente**
- `lodash@4.17.21` → `lodash@5.0.0` (bump major, mudança de constraint necessária) → **bloqueado, autorização obrigatória**

---

## Variáveis de Ambiente

| Variável | Efeito |
|----------|--------|
| `SECURITY_SCAN_NO_AUTO_FIX=1` | Ignora todas as correções automatizadas após a fase de scan. O scan ainda é executado e o código de saída ainda reflete o status de vulnerabilidades. |
| `NPM_DEFAULT_FIXER` | Sobrescreve a estratégia padrão de fix para npm. Valores válidos: `osv`, `npm-audit`, `osv-then-audit`. Padrão: `osv-then-audit`. |
| `LOG_LEVEL=debug` | Ativa o logging no nível debug para saída interna detalhada. |
| `SONAR_TOKEN` | Token de autenticação para SonarQube no modo `external`. Obrigatório quando SonarQube está ativado com `mode: external`. |

---

## Códigos de Saída

Todos os comandos seguem a mesma convenção de códigos de saída:

| Código | Significado | Quando ocorre |
|--------|-------------|---------------|
| `0` | Limpo — sucesso | Nenhuma vulnerabilidade encontrada, ou todas resolvidas |
| `1` | Problemas encontrados | Vulnerabilidades encontradas, erros de atualização, ou vulnerabilidades pendentes restam após o fix |
| `2` | Erro no scanner/gate | Falha na validação do gate, erro do OSV, ou falha inesperada do scanner |
| `3` | Erro de configuração | `security-scan.config.json` não encontrado, schema inválido, ou erro de caminho de saída do `init` |

Esses códigos tornam o security-scan utilizável como gate em pipelines de CI/CD:

```bash
security-scan scan && echo "Limpo!" || echo "Problemas encontrados (código $?)"
```

---

## O que fazer depois do `fix`

Após executar `security-scan fix`, siga este checklist para garantir que tudo está correto antes de fazer merge:

### 1. Verificar os arquivos modificados

```bash
git diff --stat
```

Confira que apenas lockfiles e arquivos esperados foram alterados (`package-lock.json`, `composer.lock`, `requirements.txt`).

### 2. Conferir o relatório executivo

Abra o relatório HTML gerado (por padrão em `./reports/`) e verifique:
- Quais vulnerabilidades foram resolvidas
- Se ainda restam vulnerabilidades pendentes (classificadas como `breaking`)
- Se algum ecossistema foi revertido por falha na validação

### 3. Executar os testes localmente

Após o fix, os lockfiles foram alterados na árvore de trabalho atual. Execute seus testes localmente para confirmar:

```bash
# npm
npm ci && npm test

# composer
composer install && php artisan test

# pip
pip install -r requirements.txt && pytest
```

### 4. Validar o `composer.lock` no ambiente correto

Se o projeto usa Composer, garanta que o `composer.lock` é consistente com o `composer.json`:

```bash
composer validate
```

Se você vir erros de "lock file is not up to date", execute `composer update --lock` no mesmo ambiente PHP do projeto (ou dentro do container Docker).

### 5. Criar branch e fazer push

```bash
git checkout -b fix/security-scan-$(date +%Y%m%d)
git add package-lock.json composer.lock requirements.txt
git commit -m "fix: apply safe dependency updates [security-scan]"
git push origin HEAD
```

### 6. Lidar com vulnerabilidades pendentes

Se o relatório mostra vulnerabilidades `breaking` não corrigidas:

1. **Avalie cada uma** — leia o motivo no relatório e decida se a atualização major é viável agora.
2. **Autorize se for seguro** — `security-scan fix --authorize-breaking npm composer`
3. **Crie um ticket** — para atualizações major que precisam de planejamento (ex.: migração de Laravel 10→11, React 18→19).

---

## Solução de Problemas

### "security-scan requires Node.js >=26"

```
security-scan requires Node.js >=26. Detected: v20.x.x
Please upgrade Node.js and try again.
```

O projeto inclui um `.nvmrc` com a versão correta. Execute:

```bash
nvm install    # instala a versão do .nvmrc se ainda não tiver
nvm use        # ativa a versão correta
```

Para nunca mais esquecer, configure o auto-use do nvm no seu shell. Adicione ao seu `~/.zshrc` (ou `~/.bashrc`):

```bash
# Ativar automaticamente a versão do .nvmrc ao entrar no diretório
autoload -U add-zsh-hook
load-nvmrc() {
  if [[ -f .nvmrc && -r .nvmrc ]]; then
    nvm use
  fi
}
add-zsh-hook chpwd load-nvmrc
load-nvmrc
```

Depois reinicie o terminal. A partir disso, sempre que você entrar em um diretório com `.nvmrc`, a versão correta será ativada automaticamente.

### "Config file not found"

```
Config file not found: ./security-scan.config.json
Run "security-scan init" first.
```

Gere o arquivo de configuração:

```bash
security-scan init
```

Ou especifique o caminho explicitamente:

```bash
security-scan scan --config /caminho/para/security-scan.config.json
```

### Docker não disponível

```
Error: docker: command not found
```

Instale o Docker em [docs.docker.com](https://docs.docker.com/get-docker/) e verifique se o daemon Docker está em execução:

```bash
docker --version
docker ps
```

### "File already exists" durante o init

```
File already exists: ./security-scan.config.json
Use --force to overwrite.
```

Use `--force` para regenerar a configuração:

```bash
security-scan init --force
```

### SonarQube — "SONAR_TOKEN not set"

```
SONAR_TOKEN environment variable is required for SonarQube external mode
```

Defina o token:

```bash
export SONAR_TOKEN=seu_token_aqui
security-scan scan
```

Ou adicione-o como secret no ambiente de CI.

### SonarQube — CE task poll retorna HTTP 403

```
SonarQube CE: task poll returned HTTP 403 — token lacks permission for the CE API.
```

O token usado para autenticação consegue submeter a análise, mas não consegue consultar a API do Compute Engine. Isso acontece quando se usa um **Project Analysis Token** (`sqp_`) ou **Global Analysis Token** (`sqa_`) em vez de um **User Token** (`squ_`).

**Solução:** gere um User Token na sua instância SonarQube (User → My Account → Security → Generate Tokens → type: User Token). Defina-o via `SONAR_TOKEN`:

```bash
export SONAR_TOKEN=squ_seu_novo_token
```

Também remova quaisquer linhas `sonar.login` ou `sonar.password` do `sonar-project.properties` — esses campos são deprecated e o sonar-scanner 5+ os rejeita.

### `composer.lock` inconsistente entre ambientes

```
The lock file is not up to date with the latest changes in composer.json
```

Isso acontece quando o `composer.lock` foi gerado em um ambiente com versão de PHP diferente da usada no deploy ou no CI. O security-scan executa o Composer dentro de um container Docker com a versão de PHP configurada em `runner.language_version` do entry do ecossistema.

**Soluções:**

1. **Garantir que a versão do PHP está correta no config:**
   ```json
   {
     "ecosystems": [
       {
         "id": "composer",
         "runner": {
           "language_version": "8.2"
         }
       }
     ]
   }
   ```

2. **Regenerar o lockfile no ambiente correto:**
   ```bash
   # Dentro de um container com a versão certa de PHP
   docker run --rm -v $(pwd):/app -w /app php:8.2-cli composer update --lock
   ```

3. **Validar antes de comitar:**
   ```bash
   composer validate
   ```

### Vulnerabilidades disruptivas não corrigidas

Esse é o comportamento esperado. Vulnerabilidades classificadas como `breaking` requerem autorização explícita:

```bash
security-scan fix --authorize-breaking npm composer
```

Verifique a saída do scan para saber quais pacotes precisam de autorização.

### `npm audit fix` causa falha na validação

Ao usar a estratégia `osv-then-audit` e o `npm audit fix` quebrar a validação, o security-scan reverte automaticamente a porção do `npm audit fix` e revalida contra o estado somente-OSV. Se o estado somente-OSV também falhar na validação, todas as mudanças no npm são revertidas.

### Comandos de validação atingem o timeout

Aumente o `timeout_seconds` para o comando de validação relevante:

```json
{
  "ecosystems": [
    {
      "id": "composer",
      "validationCommands": [
        {
          "name": "Tests",
          "command": "php artisan test",
          "timeout_seconds": 600
        }
      ]
    }
  ]
}
```

---

## Perguntas Frequentes

**P: O security-scan modifica meus lockfiles diretamente?**

Sim. Quando você executa `security-scan fix`, ele modifica `package-lock.json`, `composer.lock` e `requirements.txt` / `Pipfile.lock` dentro de containers Docker efêmeros. Use `--dry-run` para ver o que aconteceria sem fazer alterações.

**P: O que acontece se minha suíte de testes falhar após uma atualização?**

O security-scan reverte automaticamente todas as mudanças naquele ecossistema e continua com os demais. O ecossistema que falhou é reportado como "revertido" no relatório executivo.

**P: Posso usar o security-scan com um monorepo?**

Sim. Use o campo `path` em cada entry de ecossistema para apontar para o subdiretório onde o lockfile está localizado. Quando dois ou mais entries compartilham o mesmo `id` de ecossistema, adicione um `label` distinto a cada um:

```json
{
  "ecosystems": [
    {
      "id": "npm",
      "path": "packages/frontend",
      "label": "frontend",
      "fixer": "osv-then-audit"
    },
    {
      "id": "npm",
      "path": "packages/backend",
      "label": "backend",
      "fixer": "osv-then-audit"
    },
    {
      "id": "composer",
      "path": "api"
    }
  ]
}
```

O `security-scan init` descobre todos os lockfiles automaticamente com a varredura recursiva. Quando entries são encontrados em subdiretórios, um resumo de descoberta é exibido antes do checkbox para que você veja exatamente o que foi encontrado:

```
Found 3 ecosystem(s):
  npm         package-lock.json       packages/frontend/
  npm         package-lock.json       packages/backend/
  composer    composer.lock           api/
```

**Fluxo de trabalho em monorepo com split reports:**

```bash
# Passo 1: gerar config (descobre todos os lockfiles automaticamente)
security-scan init

# Passo 2: corrigir todas as entradas e gerar relatórios por entrada
security-scan fix --split-reports

# Passo 3: autorizar mudanças disruptivas apenas para o frontend
security-scan fix --authorize-breaking npm:frontend

# Passo 4: executar apenas a fase npm do backend
security-scan fix --phases scan,npm:backend,report
```

Cada entrada (identificada pela sua `ecosystemEntryKey`, ex.: `npm:frontend`) é varrida, corrigida e reportada de forma independente. O OSV Scanner executa uma vez por entrada, com escopo no lockfile daquela entrada.

**P: O security-scan suporta yarn ou pnpm?**

Atualmente apenas npm (`package-lock.json`) e yarn v1 (`yarn.lock`, apenas varredura de leitura) são suportados. pnpm ainda não é suportado.

**P: Posso executar o security-scan sem Docker?**

Docker é obrigatório para executar os CLIs de ecossistema (npm, composer, pip) na fase de fix. O OSV Scanner também usa Docker por padrão, embora possa ser executado localmente configurando `scanners.osv.runner: 'local'` no config. Não existe modo `local` para runners de ecossistema — esses sempre executam dentro de containers Docker.

**P: O que significa "autorização necessária" no relatório?**

Significa que o fix requer um bump de versão major (ex.: `v3` → `v4`) ou uma mudança na constraint declarada. Isso nunca é aplicado automaticamente. Para autorizar:

```bash
security-scan fix --authorize-breaking <ecossistema>
```

**P: Como adiciono um novo ecossistema a uma configuração existente?**

Adicione uma nova entrada em `ecosystems` no `security-scan.config.json`:

```json
{
  "ecosystems": [
    {
      "id": "pip",
      "fixer": "osv",
      "validationCommands": [
        {
          "name": "Tests",
          "command": "pytest"
        }
      ]
    }
  ]
}
```

**P: Meus secrets estão seguros com o modo managed do SonarQube?**

No modo managed, a CLI gera um token temporário via API admin do SonarQube e o passa como argumento da CLI (não é gravado em disco). Os campos `sonar.login` / `sonar.password` no `sonar-project.properties` são removidos via uma cópia sanitizada temporária (sonar-scanner 5+ rejeita a mera presença desses campos).

**P: Como faço para fixar a versão do OSV Scanner?**

```json
{
  "scanners": {
    "osv": {
      "image": "ghcr.io/google/osv-scanner:v1.9.0"
    }
  }
}
```

**P: Posso gerar relatórios em inglês e português ao mesmo tempo?**

Não em uma única execução. Defina `report_language` como `en` ou `pt-br`. Para gerar ambos, execute `executive-report` duas vezes com arquivos de configuração diferentes.

**P: O security-scan é open source?**

Sim. Licenciado sob MIT.
