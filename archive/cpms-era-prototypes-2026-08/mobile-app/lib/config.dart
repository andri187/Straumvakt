class Config {
  static const apiBase = String.fromEnvironment(
    'API_BASE',
    defaultValue: 'https://hlada-api-staging.straumvakt.workers.dev',
  );
}
