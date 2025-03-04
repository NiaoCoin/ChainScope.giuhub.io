
async function ensureEthersLoaded() {
    if (typeof ethers === 'undefined') {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js';
            script.onload = () => setTimeout(resolve, 100);
            script.onerror = () => reject(new Error('Failed to load ethers.js'));
            document.head.appendChild(script);
        });
    }
    return Promise.resolve();
}


function showLoading() {
    document.getElementById('loadingIndicator').classList.remove('d-none');
    document.getElementById('decodeButton').disabled = true;
    document.getElementById('decodeButton').innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>处理中...';
}


function hideLoading() {
    document.getElementById('loadingIndicator').classList.add('d-none');
    document.getElementById('decodeButton').disabled = false;
    document.getElementById('decodeButton').innerHTML = '<i class="fas fa-code me-2"></i>解析交易';
}


async function fetchWithTimeout(url, options, timeout = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
}


const signatureCache = new Map();
async function getFunctionSignatureFrom4ByteAPI(hash) {
    if (signatureCache.has(hash)) return signatureCache.get(hash);
    const url = `https://www.4byte.directory/api/v1/signatures/?format=json&hex_signature=${hash}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error('Signature not found');
    const data = await response.json();
    if (data.results && data.results.length > 0) {
        const sig = data.results[data.results.length - 1].text_signature;
        signatureCache.set(hash, sig);
        return sig;
    }
    throw new Error('No signature found');
}


async function getTransaction(rpcProviderUrl, txHash) {
    try {
        const response = await fetchWithTimeout(rpcProviderUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_getTransactionByHash',
                params: [txHash],
                id: 1
            })
        });
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        return await response.json();
    } catch (error) {
        throw new Error(`Failed to fetch transaction: ${error.message}`);
    }
}


function generatePythonCode(functionName, toAddress, abiInputs, value) {
    const paramDefs = abiInputs.map((input, index) => 
        `${input.name || `param_${input.type}_${index + 1}`}: ${input.type}`).join(', ');
    const paramCalls = abiInputs.map((input, index) => 
        input.name || `param_${input.type}_${index + 1}`).join(', ');
    return `from web3 import Web3
from typing import Any

def ${functionName}(web3: Web3${paramDefs ? ', ' + paramDefs : ''}) -> Any:
    contract_address = '${toAddress}'
    to_address = web3.to_checksum_address(contract_address)
    
    abi = [{
        "constant": false,
        "inputs": [${abiInputs.map(input => JSON.stringify({ name: input.name || '', type: input.type })).join(', ')}],
        "name": "${functionName}",
        "outputs": [],
        "payable": ${value !== '0x0' && value !== '0' ? 'True' : 'False'},
        "stateMutability": "${value !== '0x0' && value !== '0' ? 'payable' : 'nonpayable'}",
        "type": "function"
    }]
    
    contract = web3.eth.contract(address=to_address, abi=abi)
    
    return contract.functions.${functionName}(${paramCalls})
`;
}


function decodeInputData(input, signature) {
    const iface = new ethers.utils.Interface([`function ${signature}`]);
    const decoded = iface.parseTransaction({ data: input });
    return decoded.functionFragment.inputs.map((input, index) => ({
        name: input.name || `param_${index + 1}`,
        type: input.type,
        value: decoded.args[index].toString()
    }));
}


async function decodeTx() {
    showLoading();
    try {
        await ensureEthersLoaded();
        const txHash = document.getElementById('txHash').value.trim();
        const rpcUrl = document.getElementById('networkSelect').value;
        
        const transaction = await getTransaction(rpcUrl, txHash);
        if (!transaction || !transaction.result) throw new Error('Transaction not found or invalid response');

        updateHTMLContent('result', JSON.stringify(transaction.result, null, 2));
        
        if (transaction.result.input && transaction.result.input !== '0x') {
            const functionSig = transaction.result.input.slice(0, 10);
            try {
                const signature = await getFunctionSignatureFrom4ByteAPI(functionSig);
                const functionName = signature.split('(')[0];
                const abiInputs = decodeInputData(transaction.result.input, signature);
                const pythonCode = generatePythonCode(
                    functionName,
                    transaction.result.to, // 修复：确保使用交易中的to地址
                    abiInputs,
                    transaction.result.value || '0'
                );
                updateHTMLContent('output', pythonCode);
                showResults();
            } catch (error) {
                console.warn('Failed to decode input or get signature:', error);
                updateHTMLContent('output', `Error decoding input: ${error.message}`);
            }
        }
    } catch (error) {
        updateHTMLContent('result', `Error: ${error.message}`);
    } finally {
        hideLoading();
    }
}


function showResults() {
    document.getElementById('generatedCodeContainer').classList.remove('d-none');
    document.getElementById('decodedTransactionContainer').classList.remove('d-none');
}

function updateHTMLContent(elementId, content) {
    const element = document.getElementById(elementId);
    if (elementId === 'result') {
        try {
            const formattedJson = JSON.parse(content);
            element.innerHTML = `<pre><code class="language-json">${JSON.stringify(formattedJson, null, 2)}</code></pre>`;
            hljs.highlightElement(element.querySelector('code'));
        } catch (e) {
            element.innerHTML = `<pre><code class="language-plaintext">${content}</code></pre>`;
        }
    } else if (elementId === 'output') {
        element.innerHTML = `<pre><code class="language-python">${content}</code></pre>`;
        hljs.highlightElement(element.querySelector('code'));
    }
    element.parentElement.classList.remove('d-none');
}


function setupThemeToggle() {
    const currentTheme = localStorage.getItem('theme') || 'light';
    if (currentTheme === 'dark') {
        document.body.classList.add('dark-mode');
        updateCodeHighlightTheme('dark');
    }
    document.getElementById('themeToggle').addEventListener('click', function() {
        document.body.classList.toggle('dark-mode');
        const newTheme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
        localStorage.setItem('theme', newTheme);
        updateCodeHighlightTheme(newTheme);
        const icon = this.querySelector('i');
        icon.classList.toggle('fa-moon');
        icon.classList.toggle('fa-sun');
    });
}

function updateCodeHighlightTheme(theme) {
    const link = document.querySelector('link[href*="highlight.js"]');
    if (link) {
        link.href = theme === 'dark'
            ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/10.7.2/styles/atom-one-dark.min.css'
            : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/10.7.2/styles/atom-one-light.min.css';
    }
}


const clipboard = new ClipboardJS('#copyButton');
const codeClipboard = new ClipboardJS('#copyCodeButton');
clipboard.on('success', e => showSuccessAlert('解析结果已复制到剪贴板！'));
codeClipboard.on('success', e => showSuccessAlert('Python代码已复制到剪贴板！'));

function showSuccessAlert(message) {
    const alert = document.getElementById('success-alert');
    document.getElementById('alert-message').textContent = message;
    alert.style.display = 'block';
    setTimeout(() => alert.style.display = 'none', 3000);
}


window.onload = function() {
    setupThemeToggle();
    document.getElementById('decodeButton').addEventListener('click', debounce(decodeTx, 500));
    document.getElementById('txHash').addEventListener('focus', function() { this.value = ''; });
};

function debounce(fn, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
    };
}
