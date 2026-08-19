export const FEEDBACK_FORM_URL = 'https://forms.gle/FuxBXCpocHzhm38AA';

export const FEEDBACK_HINT_KEY = 'myraion.feedbackHintSeen';

export function openFeedbackForm(): void {
  window.open(FEEDBACK_FORM_URL, '_blank', 'noopener,noreferrer');
}
