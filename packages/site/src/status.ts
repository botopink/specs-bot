// The data repository's status, as the api's health check reports it; the api hands the site a function for it.
export interface SiteStatus {
  ok: boolean;
  branch?: string;
  head?: string;
  error?: string;
}

export type StatusFn = () => Promise<SiteStatus>;
