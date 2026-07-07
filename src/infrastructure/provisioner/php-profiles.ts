/**
 * PHP Docker image profiles for Phase 1 (stock images only).
 *
 * Phase 1 uses official php:<version>-cli images for composer execution.
 * Phase 2 (not implemented here) will add on-demand local Docker builds
 * with framework extension profiles (laravel/symfony/wordpress).
 */

/**
 * Default Docker image used when no specific PHP version is configured or inferred.
 * Uses the official composer image which bundles PHP + composer pre-installed.
 */
export const COMPOSER_DEFAULT_IMAGE = 'composer:2';

/**
 * PHP CLI image prefix used when resolving a versioned image.
 * e.g. 'php:8.2-cli'
 */
export const PHP_CLI_IMAGE_PREFIX = 'php';
export const PHP_CLI_IMAGE_SUFFIX = 'cli';

// Bootstrap command injected when the resolved image is a bare `php:*-cli` image
// (which does not bundle composer, git, or unzip). Ensures git/unzip/ca-certificates
// are present (Composer needs unzip to extract dist downloads and git to fetch
// `dev-*` branches), then downloads and installs composer into the container's PATH.
// The `command -v` guard skips the apt-get hit when the image already has them.
// Official installer: https://getcomposer.org/download/
export const COMPOSER_BOOTSTRAP =
  `(command -v git >/dev/null && command -v unzip >/dev/null) ` +
  `|| (apt-get update -qq -o APT::Sandbox::User=root && apt-get install -y --no-install-recommends -o APT::Sandbox::User=root git unzip ca-certificates) ` +
  `&& php -r "copy('https://getcomposer.org/installer','/tmp/cs.php');" ` +
  `&& php -r "\\$expected=trim(file_get_contents('https://composer.github.io/installer.sig'));\\$actual=hash_file('sha384','/tmp/cs.php');if(\\$expected!==\\$actual){fwrite(STDERR,'Composer installer SHA-384 mismatch'.chr(10));exit(1);}" ` +
  `&& php /tmp/cs.php --quiet --install-dir=/usr/local/bin --filename=composer ` +
  `&& rm -f /tmp/cs.php`;

/**
 * Returns true when `image` is a bare `php:*-cli` image that does not bundle
 * composer. Used by the composer plugin's `runtimeSpec` preamble to decide
 * whether to inject COMPOSER_BOOTSTRAP before each command.
 */
export function isPhpCliImage(image: string): boolean {
  return /^php:\d/.test(image) && image.endsWith('-cli');
}

/**
 * Supported PHP framework profile identifiers.
 *
 * - 'none': no framework-specific extensions (stock php-cli image, Phase 1 default).
 * - 'laravel': Laravel framework (requires bcmath, pdo, pdo_mysql, mbstring, etc.).
 * - 'symfony': Symfony framework (requires intl, pdo, zip, etc.).
 * - 'wordpress': WordPress (requires mysqli, gd, zip, etc.).
 */
export type FrameworkProfileId = 'none' | 'laravel' | 'symfony' | 'wordpress';

/**
 * PHP extension lists per framework profile.
 * These are informational in Phase 1 — no extensions are installed; a stock
 * php-cli image is used regardless of framework_profile.
 */
export const PHP_FRAMEWORK_PROFILES: Record<FrameworkProfileId, string[]> = {
  none: [],
  laravel: [
    'bcmath',
    'ctype',
    'fileinfo',
    'json',
    'mbstring',
    'openssl',
    'pdo',
    'pdo_mysql',
    'tokenizer',
    'xml',
    'zip',
  ],
  symfony: [
    'intl',
    'json',
    'mbstring',
    'openssl',
    'pdo',
    'pdo_mysql',
    'tokenizer',
    'xml',
    'zip',
  ],
  wordpress: [
    'gd',
    'json',
    'mbstring',
    'mysqli',
    'openssl',
    'xml',
    'zip',
  ],
};
