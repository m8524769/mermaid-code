import { getCheckoutUrl, getMermaidAiLiveUrl } from '$/util/util';

const utmMedium = 'editorSelection';
const utmCampaign = 'live_2026';

export interface EditorChooserActions {
  startTrial: (buttonClick?: string) => void;
  dismiss: (buttonClick: string) => void;
  openMermaidAiLive: (buttonClick: string) => void;
}

export const createEditorChooserActions = (close: () => void): EditorChooserActions => {
  const startTrial = (buttonClick = 'startTrial') => {
    close();
    window.open(getCheckoutUrl({ utmCampaign, utmMedium }), '_blank', 'noopener');
  };

  const dismiss = (buttonClick: string) => {
    close();
  };

  const openMermaidAiLive = (buttonClick: string) => {
    close();
    window.open(getMermaidAiLiveUrl({ utmCampaign, utmMedium }), '_blank', 'noopener');
  };

  return { startTrial, dismiss, openMermaidAiLive };
};
