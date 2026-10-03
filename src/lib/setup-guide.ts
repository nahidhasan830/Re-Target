export type SetupProgress = {
  companyName: string;
  whatsapp: boolean;
  courier: boolean;
  leads: boolean;
  media: boolean;
  campaign: boolean;
  importing: boolean;
};

export function setupGuide(progress: SetupProgress, base: '/admin' | '/app') {
  const steps = [
    { id: 'account', title: 'Set up your business', description: 'Save the company name used in your offers.', action: 'Open Account', href: `${base}/account`, complete: Boolean(progress.companyName.trim()), optional: false },
    { id: 'whatsapp', title: 'Connect WhatsApp', description: 'Link the WhatsApp account that will send your offers.', action: 'Connect WhatsApp', href: `${base}/whatsapp`, complete: progress.whatsapp, optional: false },
    { id: 'courier', title: 'Connect a courier', description: 'Connect Pathao or Steadfast to import delivered customers.', action: 'Connect a courier', href: `${base}/courier`, complete: progress.courier, optional: false },
    { id: 'leads', title: 'Import your customers', description: progress.importing && !progress.leads ? 'Import is running. Customers appear as delivered shipments are found.' : 'Customers import automatically. Review them and contact preferences in Leads.', action: progress.importing ? 'Check import' : 'Open Leads', href: `${base}/leads`, complete: progress.leads, optional: false },
    { id: 'media', title: 'Add offer media', description: 'Save images or videos in Media, or use a text-only offer.', action: 'Open Media', href: `${base}/media`, complete: progress.media, optional: true },
    { id: 'campaign', title: 'Launch your first campaign', description: 'Choose customers, write your offer, then send or schedule it.', action: 'Create a campaign', href: `${base}/campaigns/new`, complete: progress.campaign, optional: false },
  ];
  const required = steps.filter(step => !step.optional);
  const completed = required.filter(step => step.complete).length;
  return { steps, completed, total: required.length, next: required.find(step => !step.complete), complete: completed === required.length };
}
