/**
 * CSS Grid to Flexbox Fallback
 * Transforms CSS Grid layouts to Flexbox for Safari 9 compatibility
 */

import postcss, { Root, Rule, Declaration } from 'postcss';

/**
 * Convert CSS Grid properties to Flexbox equivalents
 */
export function transformGridToFlexbox(css: string): string {
  const root = postcss.parse(css);

  root.walkRules((rule: Rule) => {
    let hasGrid = false;
    let gridTemplateColumns = '';
    let gridTemplateRows = '';
    let gridGap = '';
    const flexDeclarations: Declaration[] = [];

    rule.walkDecls((decl: Declaration) => {
      // Detect grid container
      if (decl.prop === 'display' && (decl.value === 'grid' || decl.value === 'inline-grid')) {
        hasGrid = true;
        // Add flexbox fallback before grid
        const flexDisplay = decl.value === 'inline-grid' ? 'inline-flex' : 'flex';
        flexDeclarations.push(postcss.decl({
          prop: 'display',
          value: `-webkit-${flexDisplay}`
        }));
        flexDeclarations.push(postcss.decl({
          prop: 'display',
          value: flexDisplay
        }));
        flexDeclarations.push(postcss.decl({
          prop: '-webkit-flex-wrap',
          value: 'wrap'
        }));
        flexDeclarations.push(postcss.decl({
          prop: 'flex-wrap',
          value: 'wrap'
        }));
      }

      // Capture grid-template-columns for child width calculation
      if (decl.prop === 'grid-template-columns') {
        gridTemplateColumns = decl.value;
      }

      // Capture grid-template-rows
      if (decl.prop === 'grid-template-rows') {
        gridTemplateRows = decl.value;
      }

      // Convert gap to margin (will be applied to children)
      if (decl.prop === 'gap' || decl.prop === 'grid-gap') {
        gridGap = decl.value;
      }

      // Convert align-items (same in both)
      if (decl.prop === 'align-items') {
        flexDeclarations.push(postcss.decl({
          prop: '-webkit-align-items',
          value: decl.value
        }));
      }

      // Convert justify-items to justify-content
      if (decl.prop === 'justify-items') {
        const value = decl.value === 'start' ? 'flex-start' :
                      decl.value === 'end' ? 'flex-end' :
                      decl.value;
        flexDeclarations.push(postcss.decl({
          prop: '-webkit-justify-content',
          value: value
        }));
        flexDeclarations.push(postcss.decl({
          prop: 'justify-content',
          value: value
        }));
      }

      // Convert place-items
      if (decl.prop === 'place-items') {
        const [align, justify] = decl.value.split(/\s+/);
        flexDeclarations.push(postcss.decl({
          prop: '-webkit-align-items',
          value: align
        }));
        flexDeclarations.push(postcss.decl({
          prop: 'align-items',
          value: align
        }));
        if (justify) {
          flexDeclarations.push(postcss.decl({
            prop: '-webkit-justify-content',
            value: justify
          }));
          flexDeclarations.push(postcss.decl({
            prop: 'justify-content',
            value: justify
          }));
        }
      }
    });

    // Insert flex fallbacks before existing declarations
    if (hasGrid && flexDeclarations.length > 0) {
      // Add comment
      rule.prepend(postcss.comment({ text: ' Revamp: Flexbox fallback for CSS Grid ' }));
      flexDeclarations.forEach((decl, index) => {
        rule.insertAfter(rule.first!, decl);
      });
    }

    // Handle grid item properties
    rule.walkDecls((decl: Declaration) => {
      // Convert grid-column span to flex width
      if (decl.prop === 'grid-column' && decl.value.includes('span')) {
        const match = decl.value.match(/span\s*(\d+)/);
        if (match) {
          const span = parseInt(match[1], 10);
          // Approximate width based on span (assuming 12-column grid)
          const width = (span / 12 * 100).toFixed(2);
          rule.insertBefore(decl, postcss.decl({
            prop: '-webkit-flex',
            value: `0 0 ${width}%`
          }));
          rule.insertBefore(decl, postcss.decl({
            prop: 'flex',
            value: `0 0 ${width}%`
          }));
        }
      }

      // Convert align-self
      if (decl.prop === 'align-self') {
        rule.insertBefore(decl, postcss.decl({
          prop: '-webkit-align-self',
          value: decl.value
        }));
      }

      // Convert justify-self to margin auto trick
      if (decl.prop === 'justify-self') {
        if (decl.value === 'end' || decl.value === 'flex-end') {
          rule.insertBefore(decl, postcss.decl({
            prop: 'margin-left',
            value: 'auto'
          }));
        } else if (decl.value === 'start' || decl.value === 'flex-start') {
          rule.insertBefore(decl, postcss.decl({
            prop: 'margin-right',
            value: 'auto'
          }));
        } else if (decl.value === 'center') {
          rule.insertBefore(decl, postcss.decl({
            prop: 'margin-left',
            value: 'auto'
          }));
          rule.insertBefore(decl, postcss.decl({
            prop: 'margin-right',
            value: 'auto'
          }));
        }
      }
    });
  });

  return root.toString();
}

/**
 * Check if CSS contains grid properties that need transformation
 */
export function hasGridProperties(css: string): boolean {
  return /display\s*:\s*(grid|inline-grid)|grid-template|grid-column|grid-row|grid-area|grid-gap|gap\s*:/i.test(css);
}
