require('dotenv').config();
const axios = require('axios');
const { response } = require('express');
const nodemailer = require('nodemailer');
console.log("Script started");

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

const productClasses = [
  'FGDLDY',
  'FGDUNX',
  'FGDMEN',
  'FGDCHD',
  'MINLDY',
  'MINUNX',
  'MINMEN',
  'VLSLDY',
  'VLSUNX',
  'VLSMEN',
  'BDDLDY',
  'BTDLDY',
  'BDDUNX',
  'BTDUNX',
  'SHVDMN',
  'BDDMEN',
  'BTDMEN',
  'BTDCHD',
  'BDUODLDY',
  'DUODMEN',
  'STDLDY',
  'STDUNX',
  'STDMEN',
  'STDCHD',
  'MSDLDY',
  'MSDUNX',
  'MSDMEN',
  'DUOSKIN',
  'SETDSKIN',
  'SETDMAKE',
  'DDCHD',
  'SKIND',
  'SKINDMEN',
  'MAKED',
  'HAIRD',
  'HAIRDMEN'
]

const productLines = [
  'WELL',
  'MISC'
]

// Define a fixed percentage margin
const MARGIN_PERCENTAGE = 10; // Example: 10% margin

// Shopify API configuration
const shopifyAPI = axios.create({
  baseURL: `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-04`,
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': process.env.SHOPIFY_API_PASSWORD
  }
});

// Cosmopolitan API configuration
const cosmopolitanAPI = axios.create({
  baseURL: 'https://api.cosmopolitanusa.com/v1/',
  headers: { 'Authorization': `CosmoToken ${process.env.COSMOPOLITAN_API_KEY}` } 
});

async function fetchAllCosmopolitanProducts() {
  let allProducts = [];
  let nextPageUrl = 'https://api.cosmopolitanusa.com/v1/products';  // Start with the initial URL

  do {
    try {
      const response = await cosmopolitanAPI.get(nextPageUrl);
      const filteredProducts = response.data.Results.filter(product => product.Item && !product.Item.endsWith("-A"));
      allProducts = allProducts.concat(filteredProducts);
      nextPageUrl = response.data.NextUrl ? `https://${response.data.NextUrl}` : '';  // Prepare the next URL if it exists
    } catch (error) {
      console.error("Error fetching products:", error.message);
      process.exit();
      break;  // Exit the loop if there's an error
    }
  } while (nextPageUrl);  // Continue as long as there's a next page URL available

  console.log(`Filtered products count: ${allProducts.length}`); // Log the number of products after filtering
  return allProducts;  // Return the full list of products
}

//Fetch detailed Cosmopolitan Product data by Item code
async function fetchDetailedCosmopolitanProduct(itemCode) {
  const maxRetries = 3;  // Maximum number of retries
  const retryDelay = 2000;  // Initial delay between retries (in milliseconds)

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await cosmopolitanAPI.get(`/products/${itemCode}`, {
        headers: { 'Authorization': `CosmoToken ${process.env.COSMOPOLITAN_API_KEY}` }
      });
      return response.data;
      
    } catch (error) {
      if (attempt < maxRetries && (error.response?.status === 500 || error.response?.status === 503)) {
        console.warn(`Attempt ${attempt} failed for product ${itemCode}. Retrying in ${retryDelay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));  // Exponential backoff
      } else {
        console.error(`Error fetching details for product ${itemCode}:`, error.message);
        return null;  // Return null if all retries fail
      }
    }
  }
}

//Fetch all Shopify products
async function fetchAllShopifyProducts() {
  let allProducts = [];
  let pageInfo = null;
  let lastRequestTime = Date.now();

  do {
    let url = `/products.json?fields=id,variants,images&limit=250`; 
    if (pageInfo) {
      url += `&page_info=${pageInfo}`;
    }

    // Calculate the time since the last request
    let timeSinceLastRequest = Date.now() - lastRequestTime;
    if (timeSinceLastRequest < 1000) { // Ensure at least 1 second between requests
      await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastRequest));
    }

    try {
      const response = await shopifyAPI.get(url);
      allProducts = allProducts.concat(response.data.products);
      const linkHeader = response.headers['link'];
      if (linkHeader) {
        const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (matches) {
          pageInfo = new URL(matches[1]).searchParams.get('page_info');
        } else {
          pageInfo = null;
        }
      } else {
        pageInfo = null;
      }
      lastRequestTime = Date.now(); // Update the last request time

    } catch (error) {
      console.error("Error encountered:", error);
      if (error.response && error.response.status === 429) {
        const retryAfter = error.response.headers['retry-after'] ? parseInt(error.response.headers['retry-after']) * 1000 : 1000;
        console.error(`Rate limit hit, retrying after ${retryAfter / 1000} seconds`);
        await new Promise(resolve => setTimeout(resolve, retryAfter));
      } else {
        break; // Exit the loop on non-retryable errors
      }
    }
  } while (pageInfo);
  return allProducts;  
}

//Fetch Detaked Shopify product data by SKU using Shopify GraphQL API
const fetchProductBySKU = async (sku) => {
  const url = `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-07/graphql.json`; 
  const query = `
    {
      products(first: 1, query: "sku:${sku}") {
        edges {
          node {
            id
            title
            variants(first: 1) {
              edges {
                node {
                  sku
                  price
                  title
                  id
                  inventoryQuantity
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': `${process.env.SHOPIFY_API_PASSWORD}`, // Replace with your Shopify Admin API access token
    },
    body: JSON.stringify({ query })
  });

  const result = await response.json();
  // const productID = (result.data.products.edges[0].node.id).substring(22);
  const edges = result.data.products.edges[0];  
  return edges;
};

// fetchProductBySKU('07QMDS36')

//Create or Update Shopify Products
async function createOrUpdateShopifyProduct(detailedProductInfo, cosmopolitanSKUs, shopifySKUs) {
  const netPrice = parseFloat(detailedProductInfo.Net);
  let markupPercentage = 0;
  if (netPrice <= 24.99) markupPercentage = 30;
  else if (netPrice <= 50.00) markupPercentage = 25;
  else markupPercentage = 20;
  const finalPrice = Math.ceil((netPrice * (1 + markupPercentage / 100)) * 100) / 100;

  const retailPrice = parseFloat(detailedProductInfo.Retail);
  const compareAtPrice = retailPrice.toFixed(2);

  const fullDescription = `<strong>Description:</strong> ${detailedProductInfo.Desc}
    ${detailedProductInfo.Desc2 || ""}
    ${detailedProductInfo.Desc3 || ""}<br>
    <strong>UPC:</strong> ${detailedProductInfo.UPC}<br>
    <strong>Size:</strong> ${detailedProductInfo.Size}<br>
    <strong>Designer:</strong> ${detailedProductInfo.Designer}<br>
    <strong>Fragrance:</strong> ${detailedProductInfo.Fragrance}`;

  // Initial data setup for a new product
  const productData = {
    product: {
      title: detailedProductInfo.Desc,
      body_html: fullDescription,
      vendor: "Cosmopolitan",
      product_type: detailedProductInfo.Product,
      tags: [
        detailedProductInfo.ProductLine ? `ProductLine_${detailedProductInfo.ProductLine}` : 'Unclassified',
        detailedProductInfo.ProductClass ? `ProductClass_${detailedProductInfo.ProductClass}` : 'Unclassified',
        `Designer_${detailedProductInfo.Designer}`,
        detailedProductInfo.Fragrance ? `Fragrance_${detailedProductInfo.Fragrance}` : 'No Fragrance'
      ],
      variants: [{
        price: finalPrice.toString(),
        compare_at_price: compareAtPrice,
        sku: detailedProductInfo.Item,
        inventory_quantity: detailedProductInfo.Available,
        inventory_management: 'shopify',
        barcode: detailedProductInfo.UPC,
        weight: detailedProductInfo.Weight || '0',
        weight_unit: 'oz',
      }],
      status: 'active'
    }
  };

  let updatedShopifyProduct = 0;

  try {
    const existingProduct = await fetchProductBySKU(detailedProductInfo.Item);
    
    if (!(existingProduct === undefined) && (existingProduct.node.variants.edges[0].node.inventoryQuantity !== detailedProductInfo.Available) && existingProduct.node.status !== "ARCHIVED") {
      const productID = (existingProduct.node.id).substring(22)

      // Update the existing product
      // delete productData.product.images;
      delete productData.product.title;
      delete productData.product.body_html;
      delete productData.product.tags;

      await shopifyAPI.put(`/products/${productID}.json`, productData);
      console.log(`Updated product ${productID} in Shopify.`);
      updatedShopifyProduct += 1;
    } else if (!cosmopolitanSKUs.has(detailedProductInfo.Item)) {
      // Draft the product if it does not exist in Cosmopolitan
      console.log(`Drafting product ${detailedProductInfo.Item} as it is no longer available on Cosmopolitan.`);
      await shopifyAPI.put(`/products/${productID}.json`, { product: { status: 'draft' } });
    } else if (!shopifySKUs.has(detailedProductInfo.Item)) {
      // Create a new product only if it doesn't already exist in Shopify
      console.log(`Creating new product with SKU ${detailedProductInfo.Item} in Shopify.`);
      productData.product.images = detailedProductInfo.ImageURL ? [{ src: detailedProductInfo.ImageURL }] : [];
      const response = await shopifyAPI.post('/products.json', productData);
      console.log(`Created new product in Shopify: ${response.data.product.id}`);
    } else {
      console.log(`Product with SKU ${detailedProductInfo.Item} already exists in Shopify. Skipping creation.`);
    }
  } catch (error) {
    console.error(`Error creating or updating Shopify product: ${error.message}`);
    // Additional logging if a new product is created with an existing SKU
    if (error.response && error.response.data.errors && error.response.data.errors.sku) {
      console.error(`Attempted to create a product with an existing SKU: ${detailedProductInfo.Item}`);
    }
  }

  return updatedShopifyProduct;

}

async function processAllCosmopolitanProducts() {
  const startTime = Date.now();
  console.log(`Start time: ${new Date(startTime).toLocaleString()}`);
  // let activeCosmoProducts =[];

  const products = await fetchAllCosmopolitanProducts(); 
  const cosmopolitanSKUs = new Set(products.map(product => product.Item)); // Fetch all Cosmopolitan SKUs
  const allShopifyProducts = await fetchAllShopifyProducts();
  const shopifySKUs = new Set(allShopifyProducts.flatMap(product => product.variants.map(variant => variant.sku))); // Fetch all Shopify SKUs

  const activeShopifyProducts = allShopifyProducts.filter(product => product.variants[0].inventory_quantity > 0);

  let activeCosmoProducts = 0;
  let updatedShopifyProducts = 0;

  for (const product of products) {    
    const detailedProductInfo = await fetchDetailedCosmopolitanProduct(product.Item);

    // Check if the product SKU ends with '-A'
    if (product.Item.endsWith('-A')) {
      console.log(`Skipping product ${product.Item} because it ends with '-A'.`);
      continue;  // Skip the rest of the loop and move to the next product
    }
    if (detailedProductInfo) {
      const { ProductLine, ProductClass } = detailedProductInfo;      
      // Use includes for faster checks
      const isProductLineValid = productLines.includes(ProductLine);
      const isProductClassValid = productClasses.includes(ProductClass);           
  
      if (!isProductLineValid && !isProductClassValid) {
        // activeCosmoProducts = activeCosmoProducts.concat(product);
        // Run asynchronous function
        activeCosmoProducts += 1;
        const updatedShopifyProduct = await createOrUpdateShopifyProduct(detailedProductInfo, cosmopolitanSKUs, shopifySKUs);
        updatedShopifyProducts += updatedShopifyProduct;
      } else {
        console.log(`Skipping product ${product.Item} with ProductClass '${ProductClass}' or ProductLine '${ProductLine}'.`);
      }
    } 
  }

  if (products.length > 2000) {
    for (const activeShopifyProduct of activeShopifyProducts) {    
      if (!cosmopolitanSKUs.has(activeShopifyProduct.variants[0].sku) && activeShopifyProduct.variants[0].inventory_quantity > 0) {      
        const variantsData = {
          price: activeShopifyProduct.variants[0].price,
          compare_at_price: activeShopifyProduct.variants[0].compare_at_price,
          sku: activeShopifyProduct.variants[0].sku,
          inventory_quantity: 0,
          inventory_management: 'shopify',
          barcode: activeShopifyProduct.variants[0].barcode,
          weight: activeShopifyProduct.variants[0].weight,
          weight_unit: 'oz',
        }
        console.log(`Updating product ${activeShopifyProduct.variants[0].sku} as Sold Out`);
        await shopifyAPI.put(`/products/${activeShopifyProduct.id}.json`, { product: { variants: [variantsData] } });
        // await shopifyAPI.put(`/products/${activeShopifyProduct.id}.json`, { product: { status: 'draft' } });
        console.log(`Product ${activeShopifyProduct.variants[0].sku} Sold Out`);
      }
    }
  }

  // console.log("Active Shopify Products", activeCosmoProducts.length)
  console.log("Number of Updated Shopify Products:", updatedShopifyProducts)
  console.log("Number of Available Cosmo Products:", activeCosmoProducts)
  
  const endTime = Date.now();
  console.log(`End time: ${new Date(endTime).toLocaleString()}`);
}

module.exports = {
  processAllCosmopolitanProducts,
  fetchDetailedCosmopolitanProduct
};
