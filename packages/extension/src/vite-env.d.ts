/// <reference types="vite/client" />
declare module '@product-logo' {
  const url: string;
  export default url;
}

interface Window {
  __BOOKMARK_ASSISTANT_DEMO__?: {
    scenario: string;
    locale: string;
    frozenTime: string;
    ready: boolean;
  };
}
