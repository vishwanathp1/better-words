"use strict";
// This plugin will open a window to prompt the user to enter a number, and
// it will then create that many rectangles on the screen.
// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).
// This shows the HTML page in "ui.html".
figma.showUI(__html__, { width: 500, height: 600 });
// Calls to "parent.postMessage" from within the HTML page will trigger this
// callback. The callback will be passed the "pluginMessage" property of the
// posted message.

// Storage keys
const STORAGE_KEYS = {
  API_KEY: 'openai_api_key',
  INSTRUCTIONS: 'custom_instructions'
};

// Function to save data to client storage
async function saveToStorage(key, value) {
  await figma.clientStorage.setAsync(key, value);
}

// Function to load data from client storage
async function loadFromStorage(key) {
  return await figma.clientStorage.getAsync(key);
}

// Function to get text from a node
function getTextFromNode(node) {
  if (node.type === 'TEXT') {
    return node.characters;
  }
  return '';
}

// Keep track of the current text and processed nodes
let currentText = '';
let processedNodeIds = new Set();

// Function to get text from multiple nodes while preserving selection order
function getTextFromNodes(nodes) {
  // Get the current selection to maintain order
  const selection = figma.currentPage.selection;
  
  // Create a map of node IDs to their text content
  const nodeTextMap = new Map();
  nodes.forEach(node => {
    nodeTextMap.set(node.id, getTextFromNode(node));
  });
  
  // Get text in selection order, maintaining the exact order from selection array
  const newText = selection
    .filter(node => node.type === 'TEXT' && !processedNodeIds.has(node.id)) // Only include new text nodes
    .map(node => {
      processedNodeIds.add(node.id); // Mark node as processed
      return nodeTextMap.get(node.id);
    })
    .filter(text => text && text.length > 0) // Filter out undefined and empty text
    .join('\n\n'); // Use double newline to separate text layers
  
  // If there's existing text, append the new text with a separator
  if (currentText && currentText !== 'No text selected' && newText) {
    currentText = currentText + '\n\n' + newText;
  } else if (newText) {
    currentText = newText;
  }
  
  return currentText;
}

// Function to check if a node is a text node
function isTextNode(node) {
  return node.type === 'TEXT';
}

// Function to check if any of the selected nodes are text nodes
function hasTextNodes(nodes) {
  return nodes.some(node => isTextNode(node));
}

// Function to get all text nodes from selection
function getTextNodesFromSelection() {
  const selection = figma.currentPage.selection;
  return selection.filter(node => node.type === 'TEXT');
}

// Function to update UI with selected text
function updateSelectedText() {
  const selection = figma.currentPage.selection;
  const textNodes = selection.filter(node => node.type === 'TEXT');
  
  // If no text nodes are selected, reset the state
  if (textNodes.length === 0) {
    currentText = 'No text selected';
    processedNodeIds.clear();
    figma.ui.postMessage({
      type: 'selected-text',
      text: currentText,
      count: 0
    });
    return;
  }

  // Check if any previously processed nodes are no longer selected
  const selectedNodeIds = new Set(textNodes.map(node => node.id));
  for (const nodeId of processedNodeIds) {
    if (!selectedNodeIds.has(nodeId)) {
      processedNodeIds.delete(nodeId);
    }
  }

  const text = getTextFromNodes(textNodes);
  figma.ui.postMessage({
    type: 'selected-text',
    text: text,
    count: textNodes.length
  });
}

// Function to validate API key
function validateApiKey(apiKey) {
  if (!apiKey) return false;
  // OpenAI API keys start with 'sk-' and are typically 51 characters long
  return apiKey.startsWith('sk-') && apiKey.length >= 51;
}

// Function to sanitize text for API request
function sanitizeText(text) {
  // Remove any non-printable characters and normalize line endings
  return text
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control characters
    .replace(/\r\n/g, '\n') // Normalize line endings
    .trim();
}

// Function to call OpenAI API
async function callOpenAI(text, apiKey, instructions) {
  try {
    // Validate API key
    if (!validateApiKey(apiKey)) {
      throw new Error('Invalid API key format. Please check your OpenAI API key.');
    }

    // Sanitize the text before sending
    const sanitizedText = sanitizeText(text);
    const sanitizedInstructions = instructions ? sanitizeText(instructions) : '';
    
    console.log('Making API request with key:', apiKey.substring(0, 7) + '...'); // Log first 7 chars for debugging
    
    const requestBody = {
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that improves text. Follow these instructions: " + sanitizedInstructions
        },
        {
          role: "user",
          content: "Please improve the following text while maintaining its meaning: " + sanitizedText
        }
      ],
      temperature: 0.9
    };

    console.log('OpenAI Request Body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      let errorMessage = 'API request failed';
      
      if (response.status === 401) {
        errorMessage = 'Invalid API key. Please check your OpenAI API key and try again.';
      } else if (errorData.error && errorData.error.message) {
        errorMessage = errorData.error.message;
      } else {
        errorMessage = `API request failed with status ${response.status}`;
      }
      
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    throw error;
  }
}

// Load saved data and send to UI
async function loadSavedData() {
  const [savedApiKey, savedInstructions] = await Promise.all([
    loadFromStorage(STORAGE_KEYS.API_KEY),
    loadFromStorage(STORAGE_KEYS.INSTRUCTIONS)
  ]);

  figma.ui.postMessage({
    type: 'load-saved-data',
    apiKey: savedApiKey || '',
    instructions: savedInstructions || ''
  });
}

// Listen for selection changes
figma.on('selectionchange', () => {
  updateSelectedText();
});

// Initial check for selection
updateSelectedText();

// Load saved data when plugin starts
loadSavedData();

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'cancel') {
    figma.closePlugin();
  } else if (msg.type === 'process-text') {
    try {
      const textNodes = getTextNodesFromSelection();
      if (textNodes.length === 0) {
        figma.ui.postMessage({
          type: 'process-result',
          error: 'Please select at least one text layer'
        });
        return;
      }

      const text = getTextFromNodes(textNodes);
      const result = await callOpenAI(text, msg.apiKey, msg.instructions);
      
      // Save the API key and instructions after successful processing
      await Promise.all([
        saveToStorage(STORAGE_KEYS.API_KEY, msg.apiKey),
        saveToStorage(STORAGE_KEYS.INSTRUCTIONS, msg.instructions)
      ]);
      
      figma.ui.postMessage({
        type: 'process-result',
        result: result
      });
    } catch (error) {
      figma.ui.postMessage({
        type: 'process-result',
        error: error.message
      });
    }
  } else if (msg.type === 'save-instructions') {
    // Save instructions when they're updated
    await saveToStorage(STORAGE_KEYS.INSTRUCTIONS, msg.instructions);
  }
};
