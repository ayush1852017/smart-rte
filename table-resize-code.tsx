// Table Column and Row Resizing Feature for ClassicEditor
// This code should be added to the ClassicEditor.tsx file

// ==================== ADD THESE STATE REFS AFTER LINE 80 ====================
// Add table resize state tracking
const tableResizeRef = useRef<{
  type: 'column' | 'row';
  table: HTMLTableElement;
  index: number;
  startPos: number;
  startSize: number;
  cells: HTMLTableCellElement[];
} | null>(null);

// ==================== ADD THESE FUNCTIONS AFTER LINE 817 (after toggleBorderSelection) ====================

// Get all cells in a specific column
const getColumnCells = (table: HTMLTableElement, colIndex: number): HTMLTableCellElement[] => {
  const tbody = table.querySelector('tbody');
  if (!tbody) return [];
  const cells: HTMLTableCellElement[] = [];
  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.forEach(row => {
    const rowCells = cellsOfRow(row as HTMLTableRowElement);
    if (rowCells[colIndex]) {
      cells.push(rowCells[colIndex]);
    }
  });
  return cells;
};

// Handle column resize start
const startColumnResize = (table: HTMLTableElement, colIndex: number, clientX: number) => {
  const cells = getColumnCells(table, colIndex);
  if (cells.length === 0) return;
  
  const firstCell = cells[0];
  const currentWidth = firstCell.offsetWidth;
  
  tableResizeRef.current = {
    type: 'column',
    table,
    index: colIndex,
    startPos: clientX,
    startSize: currentWidth,
    cells,
  };
  
  // Add resize cursor to body
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
};

// Handle row resize start
const startRowResize = (table: HTMLTableElement, rowIndex: number, clientY: number) => {
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const row = rows[rowIndex] as HTMLTableRowElement | undefined;
  if (!row) return;
  
  const cells = cellsOfRow(row);
  const currentHeight = row.offsetHeight;
  
  tableResizeRef.current = {
    type: 'row',
    table,
    index: rowIndex,
    startPos: clientY,
    startSize: currentHeight,
    cells,
  };
  
  // Add resize cursor to body
  document.body.style.cursor = 'row-resize';
  document.body.style.userSelect = 'none';
};

// Handle resize move
const handleTableResizeMove = (e: MouseEvent | TouchEvent) => {
  const resize = tableResizeRef.current;
  if (!resize) return;
  
  e.preventDefault();
  
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
  
  if (resize.type === 'column') {
    const delta = clientX - resize.startPos;
    const newWidth = Math.max(60, resize.startSize + delta);
    
    // Apply new width to all cells in the column
    resize.cells.forEach(cell => {
      (cell as HTMLElement).style.width = `${newWidth}px`;
      (cell as HTMLElement).style.minWidth = `${newWidth}px`;
      (cell as HTMLElement).style.maxWidth = `${newWidth}px`;
    });
  } else if (resize.type === 'row') {
    const delta = clientY - resize.startPos;
    const newHeight = Math.max(30, resize.startSize + delta);
    
    // Apply new height to the row
    const tbody = resize.table.querySelector('tbody');
    if (tbody) {
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const row = rows[resize.index] as HTMLTableRowElement | undefined;
      if (row) {
        (row as HTMLElement).style.height = `${newHeight}px`;
        resize.cells.forEach(cell => {
          (cell as HTMLElement).style.height = `${newHeight}px`;
        });
      }
    }
  }
};

// Handle resize end
const handleTableResizeEnd = () => {
  if (tableResizeRef.current) {
    tableResizeRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    handleInput(); // Trigger change event
  }
};

// Add resize handles to tables
const addTableResizeHandles = () => {
  if (!table) return;
  const el = editableRef.current;
  if (!el) return;
  
  const tables = el.querySelectorAll('table');
  tables.forEach(table => {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    
    // Add column resize handles
    const firstRow = tbody.querySelector('tr');
    if (firstRow) {
      const cells = cellsOfRow(firstRow as HTMLTableRowElement);
      cells.forEach((cell, index) => {
        // Add data attribute for resize detection
        (cell as HTMLElement).setAttribute('data-col-index', String(index));
      });
    }
    
    // Add row resize handles
    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.forEach((row, index) => {
      (row as HTMLElement).setAttribute('data-row-index', String(index));
    });
  });
};

//==================== ADD THESE EVENT HANDLERS IN A useEffect AFTER LINE 271 ====================

useEffect(() => {
  const el = editableRef.current;
  if (!el) return;
  
  // Add resize handles to existing tables
  addTableResizeHandles();
  
  // Detect resize handle interaction
  const onMouseDown = (e: MouseEvent) => {
    if (!table) return;
    
    const target = e.target as HTMLElement;
    
    // Check if clicking near a column border (right edge of cell)
    if (target.tagName === 'TD' || target.tagName === 'TH') {
      const rect = target.getBoundingClientRect();
      const rightEdge = rect.right;
      const clickX = e.clientX;
      
      // If within 5px of right edge, start column resize
      if (Math.abs(clickX - rightEdge) < 5) {
        e.preventDefault();
        const tableElem = target.closest('table') as HTMLTableElement;
        const colIndex = parseInt(target.getAttribute('data-col-index') || '0', 10);
        if (tableElem) {
          startColumnResize(tableElem, colIndex, e.clientX);
        }
        return;
      }
      
      // Check if clicking near a row border (bottom edge of cell)
      const bottomEdge = rect.bottom;
      const clickY = e.clientY;
      
      // If within 5px of bottom edge, start row resize
      if (Math.abs(clickY - bottomEdge) < 5) {
        e.preventDefault();
        const tableElem = target.closest('table') as HTMLTableElement;
        const row = target.closest('tr') as HTMLTableRowElement;
        if (tableElem && row) {
          const rowIndex = parseInt(row.getAttribute('data-row-index') || '0', 10);
          startRowResize(tableElem, rowIndex, e.clientY);
        }
        return;
      }
    }
  };
  
  const onMouseMove = (e: MouseEvent) => {
    if (tableResizeRef.current) {
      handleTableResizeMove(e);
      return;
    }
    
    // Update cursor when hovering over resize zones
    if (!table) return;
    const target = e.target as HTMLElement;
    
    if (target.tagName === 'TD' || target.tagName === 'TH') {
      const rect = target.getBoundingClientRect();
      const clickX = e.clientX;
      const clickY = e.clientY;
      
      // Check column resize zone
      if (Math.abs(clickX - rect.right) < 5) {
        el.style.cursor = 'col-resize';
        return;
      }
      
      // Check row resize zone
      if (Math.abs(clickY - rect.bottom) < 5) {
        el.style.cursor = 'row-resize';
        return;
      }
      
      // Reset cursor if not in resize zone
      if (el.style.cursor === 'col-resize' || el.style.cursor === 'row-resize') {
        el.style.cursor = '';
      }
    }
  };
  
  const onMouseUp = () => {
    handleTableResizeEnd();
  };
  
  // Touch events for mobile
  const onTouchStart = (e: TouchEvent) => {
    if (!table) return;
    
    const target = e.target as HTMLElement;
    if (target.tagName === 'TD' || target.tagName === 'TH') {
      const rect = target.getBoundingClientRect();
      const touch = e.touches[0];
      const clickX = touch.clientX;
      const clickY = touch.clientY;
      
      // Column resize
      if (Math.abs(clickX - rect.right) < 15) {
        e.preventDefault();
        const tableElem = target.closest('table') as HTMLTableElement;
        const colIndex = parseInt(target.getAttribute('data-col-index') || '0', 10);
        if (tableElem) {
          startColumnResize(tableElem, colIndex, clickX);
        }
        return;
      }
      
      // Row resize
      if (Math.abs(clickY - rect.bottom) < 15) {
        e.preventDefault();
        const tableElem = target.closest('table') as HTMLTableElement;
        const row = target.closest('tr') as HTMLTableRowElement;
        if (tableElem && row) {
          const rowIndex = parseInt(row.getAttribute('data-row-index') || '0', 10);
          startRowResize(tableElem, rowIndex, clickY);
        }
        return;
      }
    }
  };
  
  const onTouchMove = (e: TouchEvent) => {
    if (tableResizeRef.current) {
      handleTableResizeMove(e);
    }
  };
  
  const onTouchEnd = () => {
    handleTableResizeEnd();
  };
  
  // Add event listeners
  el.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  el.addEventListener('touchstart', onTouchStart, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd);
  
  return () => {
    el.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    el.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
  };
}, [table]);

// Also update the insertTable function to add resize handles to new tables
// Modify line 473 in insertTable function to add:
if (node) {
  // Add resize handles
  const tbody = node.querySelector('tbody');
  if (tbody) {
    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.forEach((row, index) => {
      (row as HTMLElement).setAttribute('data-row-index', String(index));
      const cells = cellsOfRow(row as HTMLTableRowElement);
      cells.forEach((cell, cellIndex) => {
        (cell as HTMLElement).setAttribute('data-col-index', String(cellIndex));
      });
    });
  }
}

// ==================== ADD THESE CSS STYLES ====================
// These styles should be added to the editable div or a parent container

const tableResizeStyles = `
  /* Resize cursor hints */
  table td:hover,
  table th:hover {
    position: relative;
  }
  
  /* Column resize visual hint */
  table td::after,
  table th::after {
    content: '';
    position: absolute;
    right: -2px;
    top: 0;
    bottom: 0;
    width: 4px;
    cursor: col-resize;
    background: transparent;
  }
  
  table td:hover::after,
  table th:hover::after {
    background: rgba(59, 130, 246, 0.3);
  }
  
  /* Row resize visual hint */
  table tr::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -2px;
    height: 4px;
    cursor: row-resize;
    background: transparent;
    pointer-events: all;
  }
  
  table tr:hover::after {
    background: rgba(59, 130, 246, 0.3);
  }
  
  /* Prevent text selection during resize */
  .table-resizing {
    user-select: none;
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
  }
`;

// Add a <style> tag in the component return, or inject it dynamically
