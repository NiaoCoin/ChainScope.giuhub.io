// Ethers.js 
async function ensureEthersLoaded() {
    if (typeof ethers === 'undefined') {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.ethers.io/lib/ethers-5.7.2.umd.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load ethers.js'));
            document.head.appendChild(script);
        });
    }
    return Promise.resolve();
}

// 从 4byte API 获取函数签名
async function getFunctionSignatureFrom4ByteAPI(hash) {
    const url = `https://www.4byte.directory/api/v1/signatures/?format=json&hex_signature=${hash}`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error('Signature not found');
    }

    const data = await response.json();
    if (data.results && data.results.length > 0) {
        return data.results[data.results.length - 1].text_signature;
    }
    throw new Error('No signature found in the response');
}

// 获取交易信息
async function getTransaction(rpcProviderUrl, txHash) {
    const response = await fetch(rpcProviderUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getTransactionByHash',
            params: [txHash],
            id: 1
        })
    });
    return await response.json();
}

// 生成 Python 代码
function generatePythonCode(functionName, toAddress, abiInputs, value) {
    const paramDefs = abiInputs.map((input, index) => 
        `param_${input.type.replace(/[^a-zA-Z0-9]/g, '_')}_${index + 1}: ${input.type}`).join(', ');
    
    const paramCalls = abiInputs.map((input, index) => 
        `param_${input.type.replace(/[^a-zA-Z0-9]/g, '_')}_${index + 1}`).join(', ');

    return `from web3 import Web3
from typing import Any

def ${functionName}(web3: Web3, ${paramDefs}) -> Any:
    contract_address = '${toAddress}'
    to_address = web3.to_checksum_address(contract_address)
    
    abi = [{
        "constant": ${value > 0 ? 'True' : 'False'},
        "inputs": [${abiInputs.map(JSON.stringify).join(', ')}],
        "name": "${functionName}",
        "outputs": [],
        "payable": ${value > 0 ? 'True' : 'False'},
        "stateMutability": "${value > 0 ? 'payable' : 'nonpayable'}",
        "type": "function"
    }]
    
    contract = web3.eth.contract(address=to_address, abi=abi)
    
    return contract.functions.${functionName}(${paramCalls})
`;
}

// 主要解码函数
async function decodeTx() {
    showLoading();
    try {
        await ensureEthersLoaded();
        const txHash = document.getElementById('txHash').value.trim();
        const rpcUrl = document.getElementById('networkSelect').value;
        
        const transaction = await getTransaction(rpcUrl, txHash);
        if (!transaction.result) {
            throw new Error('Transaction not found');
        }

        updateHTMLContent('result', JSON.stringify(transaction.result, null, 2));
        
        if (transaction.result.input && transaction.result.input !== '0x') {
            const functionSig = transaction.result.input.slice(0, 10);
            try {
                const signature = await getFunctionSignatureFrom4ByteAPI(functionSig);
                const pythonCode = generatePythonCode(
                    signature.split('(')[0],
                    transaction.result.to,
                    [], 
                    transaction.result.value || '0'
                );
                updateHTMLContent('output', pythonCode);
                showResults();
            } catch (error) {
                console.warn('Failed to get function signature:', error);
            }
        }
    } catch (error) {
        updateHTMLContent('result', `Error: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// 辅助函数
function showLoading() {
    document.getElementById('loadingIndicator').classList.remove('d-none');
    document.getElementById('decodeButton').disabled = true;
}

function hideLoading() {
    document.getElementById('loadingIndicator').classList.add('d-none');
    document.getElementById('decodeButton').disabled = false;
}

function showResults() {
    document.getElementById('generatedCodeContainer').classList.remove('d-none');
    document.getElementById('decodedTransactionContainer').classList.remove('d-none');
}

function updateHTMLContent(elementId, content) {
    const element = document.getElementById(elementId);
    
    // 根据内容类型进行格式化
    if (elementId === 'result') {
        try {
            // 格式化 JSON 数据
            const formattedJson = JSON.parse(content);
            const formattedContent = formatTransactionData(formattedJson);
            element.innerHTML = `<pre><code class="language-json">${formattedContent}</code></pre>`;
            hljs.highlightElement(element.querySelector('code'));
        } catch (e) {
            element.innerHTML = `<pre><code class="language-plaintext">${content}</code></pre>`;
        }
    } else if (elementId === 'output') {
        // Python 代码格式化
        element.innerHTML = `<pre><code class="language-python">${content}</code></pre>`;
        hljs.highlightElement(element.querySelector('code'));
    }

    element.style.opacity = '0';
    element.parentElement.classList.remove('d-none');

    setTimeout(() => {
        element.style.transition = 'opacity 0.5s ease';
        element.style.opacity = '1';
    }, 10);
}

// 格式化函数
function formatTransactionData(data) {
    // 格式化 wei 到 ether
    if (data.value) {
        const valueInWei = BigInt(data.value);
        const valueInEther = Number(valueInWei) / 1e18;
        data.valueFormatted = `${valueInEther} ETH (${data.value} Wei)`;
    }

    // 格式化 gas 相关数据
    if (data.gas) {
        data.gasFormatted = `${parseInt(data.gas, 16)} (0x${data.gas.slice(2)})`;
    }
    if (data.gasPrice) {
        const gasPriceWei = BigInt(data.gasPrice);
        const gasPriceGwei = Number(gasPriceWei) / 1e9;
        data.gasPriceFormatted = `${gasPriceGwei} Gwei (${data.gasPrice})`;
    }

    // 添加区块确认信息
    if (data.blockNumber) {
        data.blockNumberFormatted = `${parseInt(data.blockNumber, 16)} (0x${data.blockNumber.slice(2)})`;
    }

    return JSON.stringify(data, null, 2)
        .replace(/"([^"]+)":/g, '<span class="json-key">"$1":</span>');
}

// 主题切换相关函数
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

// 复制功能
var clipboard = new ClipboardJS('#copyButton');
var codeClipboard = new ClipboardJS('#copyCodeButton');

clipboard.on('success', function(e) {
    showSuccessAlert('解析结果已复制到剪贴板！');
    e.clearSelection();
});

codeClipboard.on('success', function(e) {
    showSuccessAlert('Python代码已复制到剪贴板！');
    e.clearSelection();
});

function showSuccessAlert(message) {
    const alert = document.getElementById('success-alert');
    if (!alert) return;
    
    const alertMessage = document.getElementById('alert-message');
    if (alertMessage) alertMessage.textContent = message;
    
    alert.style.display = 'block';
    alert.classList.add('fade-in');
    
    setTimeout(() => {
        alert.style.opacity = '0';
        setTimeout(() => {
            alert.style.display = 'none';
            alert.style.opacity = '1';
            alert.classList.remove('fade-in');
        }, 500);
    }, 3000);
}

// 初始化
window.onload = function() {
    setupThemeToggle();
    
    // 添加交易哈希输入框清空功能
    const txHashInput = document.getElementById('txHash');
    if (txHashInput) {
        txHashInput.addEventListener('focus', function() {
            this.value = '';
        });
    }
};