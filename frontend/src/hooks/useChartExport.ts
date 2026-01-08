import { useCallback } from 'react';
import { toJpeg, toPng } from 'html-to-image';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';

interface ExportOptions {
    fileName: string;
    title?: string;
}

export function useChartExport() {
    const exportToCSV = useCallback((data: any[], options: ExportOptions) => {
        if (!data || data.length === 0) return;

        // Use xlsx to create a worksheet and then CSV
        const ws = XLSX.utils.json_to_sheet(data);
        const csv = XLSX.utils.sheet_to_csv(ws);

        // Create download link
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `${options.fileName}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, []);

    const exportToExcel = useCallback((data: any[], options: ExportOptions) => {
        if (!data || data.length === 0) return;

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Data');
        XLSX.writeFile(wb, `${options.fileName}.xlsx`);
    }, []);

    const exportToJPEG = useCallback(async (elementId: string, options: ExportOptions) => {
        const element = document.getElementById(elementId);
        if (!element) return;

        try {
            const dataUrl = await toJpeg(element, {
                quality: 1.0,
                backgroundColor: '#ffffff',
            });

            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = `${options.fileName}.jpg`;
            link.click();
        } catch (error) {
            console.error('Error exporting to JPEG:', error);
        }
    }, []);

    const exportToPDF = useCallback(async (elementId: string, options: ExportOptions) => {
        const element = document.getElementById(elementId);
        if (!element) return;

        try {
            // Using toPng for PDF embedding is often safer/better quality than Jpeg at low compression
            const imgData = await toPng(element, {
                backgroundColor: '#ffffff',
            });

            const pdf = new jsPDF({
                orientation: 'landscape',
                unit: 'mm',
            });

            const imgProps = pdf.getImageProperties(imgData);
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

            if (options.title) {
                pdf.text(options.title, 10, 10);
                pdf.addImage(imgData, 'PNG', 0, 20, pdfWidth, pdfHeight);
            } else {
                pdf.addImage(imgData, 'PNG', 0, 10, pdfWidth, pdfHeight);
            }

            pdf.save(`${options.fileName}.pdf`);
        } catch (error) {
            console.error('Error exporting to PDF:', error);
        }
    }, []);

    return {
        exportToCSV,
        exportToExcel,
        exportToJPEG,
        exportToPDF,
    };
}
