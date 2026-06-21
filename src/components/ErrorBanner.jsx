import React from 'react';

export default function ErrorBanner({ error, onDismiss }) {
  if (!error) return null;

  return (
    <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-4 py-2 text-sm flex items-center justify-between">
      <span>{error}</span>
      <button onClick={onDismiss} className="ml-2 font-bold hover:text-red-900">&times;</button>
    </div>
  );
}
