# Table Column and Row Resizing Implementation Plan

## Implementation Strategy
Since this needs to work in Flutter WebView, we'll use pure HTML/CSS/JavaScript with:
- Mouse events for desktop
- Touch events for mobile/tablets
- Visual resize handles on column borders and row borders
- Minimum width/height constraints

## Key Features:
1. Column resizing - drag vertical handles between columns
2. Row resizing - drag horizontal handles between rows
3. Visual feedback during resize
4. Touch support for mobile devices
5. Minimum size constraints

## Implementation Steps:
1. Add state for tracking resize operation
2. Add mouse/touch event handlers on tables
3. Render resize handles as overlays
4. Update column widths and row heights dynamically
5. Add CSS for resize handles and cursor

## Code Integration Points:
- Add state refs near line 49 (after existing resizingRef)
- Add resize functions after table manipulation functions (around line 820)
- Add event listeners in useEffect hooks
- Add resize handle rendering in the return JSX
- Add CSS styles for handles
