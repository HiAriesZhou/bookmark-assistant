export const productConfig = {
  name: import.meta.env.VITE_APP_NAME || 'Bookmark Assistant',
  officialService: import.meta.env.VITE_OFFICIAL_SERVICE === 'true',
  apiUrl: import.meta.env.VITE_OAUTH_SERVER_URL || 'http://localhost:3333',
  // Public OAuth client ID; empty hides Google account sign-in.
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  websiteUrl: import.meta.env.VITE_WEBSITE_URL || 'http://localhost:3001',
  faqUrl: import.meta.env.VITE_FAQ_URL || '',
  privacyUrl: import.meta.env.VITE_PRIVACY_URL || '',
  termsUrl: import.meta.env.VITE_TERMS_URL || '',
  supportUrl: import.meta.env.VITE_SUPPORT_URL || '',
};
