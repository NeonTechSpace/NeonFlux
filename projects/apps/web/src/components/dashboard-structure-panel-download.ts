export function downloadJsonFile(fileName: string, content: string): void {
    if (typeof document === 'undefined') return;

    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const anchor = document.createElement('a');

    try {
        anchor.href = url;
        anchor.download = fileName;
        document.body.append(anchor);
        anchor.click();
    } finally {
        anchor.remove();
        URL.revokeObjectURL(url);
    }
}
