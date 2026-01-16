// src/components/SaveLoadButtons.tsx
// Save and Load buttons component with loading states and error display

export interface SaveLoadButtonsProps {
  onSave: () => void;
  onLoad: () => void;
  isSaving: boolean;
  isLoading: boolean;
  hasStoredData: boolean;
  error?: string | null;
}

export default function SaveLoadButtons({
  onSave,
  onLoad,
  isSaving,
  isLoading,
  hasStoredData,
  error
}: SaveLoadButtonsProps) {
  // Only show error if it's a non-empty string (trim whitespace)
  const hasError = error && error.trim().length > 0;
  
  return (
    <div className="save-load-buttons">
      <button
        className="ghost save-button"
        onClick={onSave}
        disabled={isSaving || isLoading}
        title="現在の譜面を保存"
      >
        {isSaving ? '保存中...' : '保存'}
      </button>
      
      <button
        className="ghost load-button"
        onClick={onLoad}
        disabled={isLoading || isSaving || !hasStoredData}
        title={hasStoredData ? '保存された譜面を読み込み' : '保存されたデータがありません'}
      >
        {isLoading ? '読込中...' : '読込'}
      </button>
      
      {hasError && (
        <div className="error-message" role="alert">
          {error.trim()}
        </div>
      )}
    </div>
  );
}