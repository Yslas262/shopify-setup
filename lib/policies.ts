export const UK_POLICIES = {
  refund_policy: (storeName: string) => `
<h2>Refund Policy &mdash; ${storeName}</h2>

<p>Under the UK Consumer Rights Act 2015 and the Consumer Contracts Regulations 2013, you have the right to cancel your order within <strong>14 days</strong> of receiving your goods without giving any reason.</p>

<h3>Right to Cancel</h3>
<p>You have 14 calendar days from the day after you receive your goods to notify us that you wish to cancel your order. To exercise this right, please contact us at our email address stating your order number and request for cancellation.</p>

<h3>Returns</h3>
<p>Once you have notified us of your wish to cancel, you have a further 14 days to return the goods to us. Items must be returned in their original condition, unused and in their original packaging where possible. You are responsible for the cost of returning the goods unless the items are faulty or not as described.</p>

<h3>Refunds</h3>
<p>We will process your refund within 14 days of receiving the returned goods. The refund will be made using the same method of payment used for the original transaction. Please note that delivery charges will only be refunded if the entire order is returned.</p>

<h3>Faulty or Incorrect Items</h3>
<p>Under the Consumer Rights Act 2015, goods must be of satisfactory quality, fit for purpose and as described. If you receive faulty or incorrect items, please contact us immediately. We will arrange for the return at our expense and offer a full refund or replacement.</p>

<h3>Exceptions</h3>
<p>Certain items are exempt from returns: personalised or custom-made products, perishable goods, sealed items that have been opened after delivery for hygiene reasons.</p>
  `.trim(),

  privacy_policy: (storeName: string, email: string) => `
<h2>Privacy Policy &mdash; ${storeName}</h2>

<p>This Privacy Policy explains how ${storeName} ("we", "us", "our") collects, uses and protects your personal data in accordance with the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018.</p>

<h3>Information We Collect</h3>
<ul>
  <li><strong>Personal details:</strong> name, email address, phone number, delivery and billing address</li>
  <li><strong>Payment information:</strong> processed securely through our payment provider — we do not store card details</li>
  <li><strong>Browsing data:</strong> IP address, browser type, pages visited, collected via cookies</li>
  <li><strong>Order history:</strong> products purchased, dates, amounts</li>
</ul>

<h3>How We Use Your Data</h3>
<ul>
  <li>To process and fulfil your orders</li>
  <li>To communicate with you regarding your orders and account</li>
  <li>To improve our website and services</li>
  <li>To comply with legal obligations</li>
</ul>

<h3>Legal Basis for Processing</h3>
<p>We process your data under the following lawful bases: contract performance, legitimate interest, legal obligation and, where applicable, your consent.</p>

<h3>Data Sharing</h3>
<p>We do not sell your personal data. We may share your data with trusted third parties who assist us in operating our website, conducting our business or servicing you, provided they agree to keep this information confidential.</p>

<h3>Your Rights</h3>
<p>Under UK GDPR, you have the right to: access your data, rectify inaccurate data, erase your data, restrict processing, data portability, and object to processing. To exercise any of these rights, please contact us at <strong>${email}</strong>.</p>

<h3>Cookies</h3>
<p>Our website uses cookies to enhance your browsing experience. You may disable cookies in your browser settings, though this may affect website functionality.</p>

<h3>Data Retention</h3>
<p>We retain your personal data only for as long as necessary to fulfil the purposes for which it was collected, or as required by law.</p>

<h3>Contact</h3>
<p>For any privacy-related queries, please contact us at <strong>${email}</strong>.</p>
  `.trim(),

  terms_of_service: (storeName: string) => `
<h2>Terms of Service &mdash; ${storeName}</h2>

<p>These Terms of Service govern your use of the ${storeName} website and your purchase of products from us. By accessing our website or placing an order, you agree to be bound by these terms.</p>

<h3>General Conditions</h3>
<p>We reserve the right to refuse service to anyone for any reason at any time. All products are subject to availability. We reserve the right to discontinue any product at any time.</p>

<h3>Accuracy of Information</h3>
<p>We make every effort to display product colours, images and descriptions as accurately as possible. However, we cannot guarantee that your monitor's display will be accurate. We do not warrant that product descriptions or other content are error-free.</p>

<h3>Pricing</h3>
<p>All prices are displayed in the currency shown on the website and include VAT where applicable. We reserve the right to change prices at any time without notice. Prices are confirmed at the point of order.</p>

<h3>Orders and Payment</h3>
<p>By placing an order, you are making an offer to purchase. We reserve the right to refuse or cancel any order. Payment is processed at the time of order. All transactions are processed through secure payment gateways.</p>

<h3>Delivery</h3>
<p>Estimated delivery times are provided as a guide and are not guaranteed. We are not liable for delays caused by circumstances beyond our control. Risk of loss and title for items pass to you upon delivery.</p>

<h3>Limitation of Liability</h3>
<p>To the fullest extent permitted by UK law, ${storeName} shall not be liable for any indirect, incidental, special or consequential damages arising from your use of our products or services.</p>

<h3>Governing Law</h3>
<p>These terms shall be governed by and construed in accordance with the laws of England and Wales. Any disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales.</p>
  `.trim(),

  shipping_policy: (storeName: string) => `
<h2>Shipping Policy &mdash; ${storeName}</h2>

<h3>Processing Time</h3>
<p>Orders are processed within 1-3 business days. Orders placed on weekends or bank holidays will be processed on the next business day.</p>

<h3>Shipping Methods &amp; Timeframes</h3>
<ul>
  <li><strong>Standard Delivery (UK):</strong> 5-10 business days</li>
  <li><strong>Express Delivery (UK):</strong> 2-4 business days</li>
  <li><strong>International Delivery:</strong> 10-20 business days depending on destination</li>
</ul>

<h3>Shipping Costs</h3>
<p>Shipping costs are calculated at checkout based on your delivery address and the weight of your order. We may offer free shipping promotions from time to time.</p>

<h3>Tracking</h3>
<p>Once your order has been dispatched, you will receive a confirmation email with tracking information where available.</p>

<h3>Customs &amp; Import Duties (International Orders)</h3>
<p>For orders shipped outside the UK, customs duties and import taxes may apply. These charges are the responsibility of the recipient and are not included in our prices.</p>

<h3>Undelivered Parcels</h3>
<p>If a parcel is returned to us as undeliverable, we will contact you to arrange redelivery. Additional shipping charges may apply.</p>

<h3>Contact</h3>
<p>For shipping enquiries, please contact our customer service team.</p>
  `.trim(),
};
