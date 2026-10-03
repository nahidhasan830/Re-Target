export const editorSteps = ['audience', 'message', 'review'] as const;
export const campaignViews = [...editorSteps, 'sending'] as const;
export type CampaignView = (typeof campaignViews)[number];

export function isCampaignView(value: string | undefined): value is CampaignView {
  return campaignViews.some(view => view === value);
}

export function campaignPath(base: string, id: string, view: CampaignView) {
  return `${base}/campaigns/${encodeURIComponent(id || 'new')}/${view}`;
}

export function campaignView(pathname: string): CampaignView | null {
  const match = pathname.match(/^\/(?:admin|app)\/campaigns\/[^/]+\/([^/]+)\/?$/);
  return match && isCampaignView(match[1]) ? match[1] : null;
}
