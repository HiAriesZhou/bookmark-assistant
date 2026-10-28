export const productConfig = {
  name: import.meta.env.VITE_APP_NAME || 'Bookmark Assistant',
  officialService: import.meta.env.VITE_OFFICIAL_SERVICE === 'true',
  apiUrl: import.meta.env.VITE_OAUTH_SERVER_URL || 'http://localhost:3333',
  websiteUrl: import.meta.env.VITE_WEBSITE_URL || 'http://localhost:3001',
  faqUrl: import.meta.env.VITE_FAQ_URL || '',
  privacyUrl: import.meta.env.VITE_PRIVACY_URL || '',
  termsUrl: import.meta.env.VITE_TERMS_URL || '',
  supportUrl: import.meta.env.VITE_SUPPORT_URL || '',
  // GPL source for this build; forks point it at their own repository.
  sourceUrl: import.meta.env.VITE_SOURCE_URL || 'https://github.com/HiAriesZhou/bookmark-assistant',
};
