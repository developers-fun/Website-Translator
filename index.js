const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const translate = require("google-translate-api-x");
const unfilteredlanguages = require("./languages.json");

const inputFolder = "./en"; // Path to the folder with HTML files
const outputFolder = "./"; // Path to store translated files

// Translation cache to avoid redundant requests
const translationCache = new Map();

// Function to translate text with caching
async function translateText(text, lang) {
  const cacheKey = `${lang}:${text}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  if (text.toLowerCase().includes("evaluating.tools")) {
    const parts = text.split("evaluating.tools");
    const translatedParts = await Promise.all(
      parts.map((part, index) => {
        if (index === parts.length - 1) return Promise.resolve(part); // Keep the domain part as is
        return translate(part.trim(), { to: lang, forceTo: true }).then((res) => res.text);
      })
    );
    const result = translatedParts.join("evaluating.tools");
    translationCache.set(cacheKey, result);
    return result;
  }

  try {
    const result = await translate(text.trim(), { to: lang, forceTo: true });
    translationCache.set(cacheKey, result.text);
    return result.text;
  } catch (err) {
    console.error(`Error translating text "${text}" to "${lang}": ${err.message}`);
    return text; // Return the original text if translation fails
  }
}

// Function to translate an individual element's text
async function translateElementText(element, lang) {
  const text = element.textContent.trim();
  if (!text) return;

  // Skip translation if the text starts with "©" or contains "evaluating.tools"
  if (text.startsWith("©") || text.toLowerCase().includes("evaluating.tools")) {
    return;
  }

  const translatedText = await translateText(text, lang);
  element.textContent = translatedText;
}

// Translate the content of an HTML file
async function translateHTML(filePath, relativePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const originalDom = new JSDOM(content);
  const document = originalDom.window.document;

  const elementsQuery = "h1, h2, h3, h4, span, a, button, p, label, option, div";

  // Update alternates for all languages
  for (const langObj of unfilteredlanguages.data) {
    const lang = langObj.code;
    const existingAltLink = document.querySelector(`link[rel="alternate"][hreflang="${lang}"]`);
    if (!existingAltLink) {
      const linkTag = document.createElement("link");
      linkTag.setAttribute("rel", "alternate");
      linkTag.setAttribute("hreflang", lang);
      linkTag.setAttribute("href", `https://evaluating.tools/${lang}/${relativePath}`);
      document.head.appendChild(linkTag);
    }
  }

  // Loop through the languages to create new language files if "createnew" is true
  for (const langObj of unfilteredlanguages.data) {
    if (!langObj.createnew) {
      console.log(`Skipping creation for language: ${langObj.code}`);
      continue;
    }

    const lang = langObj.code;
    try {
      // Create a fresh JSDOM for each language
      const translatedDom = new JSDOM(content);
      const translatedDocument = translatedDom.window.document;

      // Update <html lang> attribute
      const htmlTag = translatedDocument.querySelector("html");
      if (htmlTag) htmlTag.setAttribute("lang", lang);

      // Update <meta name="language">
      let metaLanguageTag = translatedDocument.querySelector('meta[name="language"]');
      if (!metaLanguageTag) {
        metaLanguageTag = translatedDocument.createElement("meta");
        metaLanguageTag.setAttribute("name", "language");
        translatedDocument.head.appendChild(metaLanguageTag);
      }
      metaLanguageTag.setAttribute("content", lang);

      // Update <link rel="canonical">
      let canonicalLink = translatedDocument.querySelector('link[rel="canonical"]');
      if (!canonicalLink) {
        canonicalLink = translatedDocument.createElement("link");
        canonicalLink.setAttribute("rel", "canonical");
        translatedDocument.head.appendChild(canonicalLink);
      }

      const cleanRelativePath = relativePath
        .replace(/\/+$/, "") // Remove trailing slashes
        .replace(/^\.+/, ""); // Remove leading dots

      const canonicalUrl = cleanRelativePath === "." || cleanRelativePath === ""
        ? `https://evaluating.tools/${lang}/`
        : `https://evaluating.tools/${lang}/${cleanRelativePath}/`;

      canonicalLink.setAttribute("href", canonicalUrl);

      // Add <link rel="alternate"> tags for all languages
      for (const alternateLangObj of unfilteredlanguages.data) {
        const alternateLang = alternateLangObj.code;
        const existingAltLink = translatedDocument.querySelector(
          `link[rel="alternate"][hreflang="${alternateLang}"]`
        );
        if (!existingAltLink) {
          const linkTag = translatedDocument.createElement("link");
          linkTag.setAttribute("rel", "alternate");
          linkTag.setAttribute("hreflang", alternateLang);
          linkTag.setAttribute("href", `https://evaluating.tools/${alternateLang}/${relativePath}`);
          translatedDocument.head.appendChild(linkTag);
        }
      }

      // Translate <title>
      const titleElement = translatedDocument.querySelector("title");
      if (titleElement) {
        const originalTitle = titleElement.textContent;
        const translatedTitle = await translateText(originalTitle, lang);
        titleElement.textContent = translatedTitle;
      }

      // Translate <meta name="description">
      const metaDescription = translatedDocument.querySelector('meta[name="description"]');
      if (metaDescription) {
        const descriptionContent = metaDescription.getAttribute("content");
        if (descriptionContent) {
          const translatedDescription = await translateText(descriptionContent, lang);
          metaDescription.setAttribute("content", translatedDescription);
        }
      }

      // Translate specified elements
      const elements = translatedDocument.querySelectorAll(elementsQuery);
      for (const element of elements) {
        if (element.tagName.toLowerCase() === "a") {
          // Handle <a> elements specially
          if (element.children.length > 0) {
            for (const child of element.children) {
              await translateElementText(child, lang);
            }
          } else {
            await translateElementText(element, lang);
          }

          // Update <a href> to replace "/en/" with `/${lang}/`
          if (element.hasAttribute("href")) {
            const href = element.getAttribute("href");
            if (href.includes("/en/")) {
              const updatedHref = href.replace("/en/", `/${lang}/`);
              element.setAttribute("href", updatedHref);
            }
          }
        } else if (element.tagName.toLowerCase() === "div" && element.textContent.trim()) {
          // Handle <div> elements with text content
          await translateElementText(element, lang);
        } else {
          await translateElementText(element, lang);
        }
      }

      // Save the translated HTML
      const langFolder = path.join(outputFolder, lang, relativePath);
      fs.mkdirSync(langFolder, { recursive: true });
      const outputFilePath = path.join(langFolder, path.basename(filePath));
      fs.writeFileSync(outputFilePath, translatedDom.serialize(), "utf8");
      console.log(`Translated: ${filePath} -> ${outputFilePath}`);
    } catch (err) {
      console.error(`Error processing file ${filePath} for language ${lang}:`, err.message);
    }
  }
}

// Recursive function to traverse folders and process files
async function processFolder(folderPath, relativePath = "") {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name);
    const newRelativePath = path.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      // Recursively process subfolders
      await processFolder(entryPath, newRelativePath);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      // Process HTML files
      await translateHTML(entryPath, path.dirname(newRelativePath));
    }
  }
}

// Main function to start the translation process
async function main() {
  if (!fs.existsSync(inputFolder)) {
    console.error("Input folder does not exist.");
    return;
  }

  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder);
  }

  await processFolder(inputFolder);
  console.log("Translation process completed!");
}

// Run the script
main().catch((err) => console.error("Error during translation process:", err));