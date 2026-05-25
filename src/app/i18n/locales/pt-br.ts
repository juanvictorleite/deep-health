import type { InitLocale } from '@app/i18n/init-locale';

export const ptBr: InitLocale = {
  // ── Language prompt ───────────────────────────────────────────────────────────
  languagePrompt: 'Language / Idioma',
  languageChoiceEn: 'English (en)',
  languageChoicePtBr: 'Português (pt-br)',

  // ── Project / client ─────────────────────────────────────────────────────────
  projectNamePrompt: 'Nome do projeto',
  clientNamePrompt: 'Nome do cliente',

  // ── Ecosystem selection ───────────────────────────────────────────────────────
  ecosystemSelectPrompt:
    'Selecione os ecossistemas para configurar (Espaço para marcar, Enter para confirmar)',

  // ── Per-ecosystem fixer ───────────────────────────────────────────────────────
  fixerStrategyPrompt: (pluginName) => `  [${pluginName}] Estratégia de correção`,

  // ── Per-ecosystem validation commands ────────────────────────────────────────
  includeValidationCommandPrompt: (pluginName, cmdName) =>
    `  [${pluginName}] Incluir comando de validação "${cmdName}"?`,
  validationCommandValuePrompt: (pluginName, cmdName) =>
    `  [${pluginName}] Comando de validação "${cmdName}"`,
  validationScriptsDetectedPrompt: (pluginName, count) =>
    `  [${pluginName}] Encontrados ${count} scripts. Selecione os comandos de validação (Espaço para marcar):`,
  noScriptsDetectedFallback: (pluginName) =>
    `  [${pluginName}] Nenhum script detectado, usando padrões.`,

  // ── Per-ecosystem advisors ────────────────────────────────────────────────────
  includeAdvisorPrompt: (pluginName, advisorName) =>
    `  [${pluginName}] Incluir advisor "${advisorName}"?`,
  advisorCommandPrompt: (pluginName, advisorName) =>
    `  [${pluginName}] Comando do advisor "${advisorName}"`,

  // ── Version prompts ───────────────────────────────────────────────────────────
  languageVersionPromptWithInferred: (pluginName, inferred) =>
    `  [${pluginName}] Versão da linguagem (detectada: ${inferred}, deixe em branco para usar a detectada)`,
  languageVersionPromptBlank: (pluginName) =>
    `  [${pluginName}] Versão da linguagem (deixe em branco para ignorar)`,
  phpVersionPromptWithInferred: (pluginName, inferred) =>
    `  [${pluginName}] Versão do PHP (detectada: ${inferred}, deixe em branco para usar a detectada)`,
  phpVersionPromptBlank: (pluginName) =>
    `  [${pluginName}] Versão do PHP (deixe em branco para ignorar)`,
  pythonVersionPromptWithInferred: (pluginName, inferred) =>
    `  [${pluginName}] Versão do Python (detectada: ${inferred}, deixe em branco para usar a detectada)`,
  pythonVersionPromptBlank: (pluginName) =>
    `  [${pluginName}] Versão do Python (deixe em branco para ignorar)`,

  // ── Build mode ────────────────────────────────────────────────────────────────
  buildModePrompt: (pluginName) => `  [${pluginName}] Modo de imagem`,
  buildModePull:
    'pull — usa uma imagem padrão do registry (pode não ter ferramentas do projeto)',
  buildModeBuild:
    'build (recomendado) — constrói a partir do Dockerfile do projeto com todas as ferramentas instaladas',
  buildDockerfilePrompt: (pluginName) => `  [${pluginName}] Caminho do Dockerfile`,
  buildContextPrompt: (pluginName) =>
    `  [${pluginName}] Contexto de build (deixe em branco para '.')`,
  buildTargetPrompt: (pluginName) =>
    `  [${pluginName}] Estágio alvo do build (deixe em branco para ignorar)`,
  buildArgsPrompt: (pluginName) =>
    `  [${pluginName}] Argumentos de build (CHAVE=VALOR separados por vírgula, deixe em branco para ignorar)`,

  // ── SonarQube ─────────────────────────────────────────────────────────────────
  enableSonarQubePrompt: 'Habilitar scanner SonarQube?',
  sonarQubeModePrompt: 'Modo do SonarQube',
  sonarQubeModeManaged:
    'Gerenciado (recomendado) — sobe um container SonarQube via Docker, sem precisar de servidor',
  sonarQubeModeExternal:
    'Externo — conecta a um servidor SonarQube existente (melhor desempenho, sem overhead de container)',

  // ── Reports / output ─────────────────────────────────────────────────────────
  generateMarkdownPrompt: 'Gerar relatórios em markdown?',
  reportsOutputDirPrompt: 'Diretório de saída dos relatórios',

  // ── Post-creation messages ────────────────────────────────────────────────────
  createdFile: (path) => `Criado: ${path}\n`,
  foundExistingSonarProps:
    'Arquivo sonar-project.properties já existe (não foi sobrescrito)\n',
  nextStepsHeader: '\nPróximos passos:\n',
  nextStepEditConfig: (path) => `  1. Edite ${path} conforme o seu projeto\n`,
  nextStepReviewProtectedPackages:
    '  2. Revise protected_packages — adicione pacotes que não devem ser atualizados automaticamente\n',
  nextStepReviewSonarProps:
    '  3. Revise sonar-project.properties — ajuste sonar.sources e sonar.exclusions para o seu projeto\n',
  nextStepRunScanStep4: (cliName) => `  4. Execute: ${cliName} scan --cwd <diretório-do-projeto>\n`,
  nextStepRunScanStep3: (cliName) => `  3. Execute: ${cliName} scan --cwd <diretório-do-projeto>\n`,
  nextStepConfigNote:
    '     (o arquivo project-config.yml será carregado da raiz do projeto por padrão)\n',
};
