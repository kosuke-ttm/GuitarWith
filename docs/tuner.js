// ギターの各弦の基準周波数（A=440Hz）
const GUITAR_STRINGS = {
    'E4': 329.63,  // 1弦
    'B3': 246.94,  // 2弦
    'G3': 196.00,  // 3弦
    'D3': 146.83,  // 4弦
    'A2': 110.00,  // 5弦
    'E2': 82.41    // 6弦
};

// 音符名のマッピング
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

class GuitarTuner {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.dataArray = null;
        this.frequencyDataArray = null;
        this.timeDataArray = null;
        this.isRunning = false;
        this.animationId = null;
        this.selectedString = 'E2';
        this.targetFrequency = GUITAR_STRINGS[this.selectedString];
        this.canvas = null;
        this.canvasContext = null;

        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.status = document.getElementById('status');
        this.frequencyDisplay = document.getElementById('frequency');
        this.noteDisplay = document.getElementById('note');
        this.needle = document.getElementById('needle');
        this.tuningStatus = document.getElementById('tuningStatus');
        this.stringButtons = document.querySelectorAll('.string-btn');
        this.canvas = document.getElementById('waveformCanvas');
        this.waveformInfo = document.getElementById('waveformInfo');
        
        // Canvas設定
        if (this.canvas) {
            this.canvasContext = this.canvas.getContext('2d');
            this.resizeCanvas();
            window.addEventListener('resize', () => this.resizeCanvas());
        }
    }

    resizeCanvas() {
        if (!this.canvas) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width - 40;
        this.canvas.height = 150;
    }

    attachEventListeners() {
        this.startBtn.addEventListener('click', () => this.start());
        this.stopBtn.addEventListener('click', () => this.stop());
        
        this.stringButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.stringButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedString = btn.dataset.string;
                this.targetFrequency = parseFloat(btn.dataset.freq);
            });
        });
    }

    async start() {
        try {
            // マイクへのアクセスを要求
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                } 
            });

            // AudioContextの作成
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.microphone = this.audioContext.createMediaStreamSource(stream);

            // 解析設定
            this.analyser.fftSize = 32768; // 高い解像度で周波数解析
            this.analyser.smoothingTimeConstant = 0.3;
            const bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Float32Array(bufferLength);
            this.frequencyDataArray = new Float32Array(bufferLength);
            this.timeDataArray = new Float32Array(this.analyser.fftSize);

            // マイクをアナライザーに接続
            this.microphone.connect(this.analyser);

            // UI更新
            this.startBtn.disabled = true;
            this.stopBtn.disabled = false;
            this.status.innerHTML = '<p class="success">✓ マイクが有効です</p>';
            this.isRunning = true;

            // 周波数解析を開始
            this.analyze();
        } catch (error) {
            console.error('マイクアクセスエラー:', error);
            this.status.innerHTML = '<p class="error">✗ マイクへのアクセスが拒否されました</p>';
        }
    }

    stop() {
        if (this.microphone && this.microphone.mediaStream) {
            this.microphone.mediaStream.getTracks().forEach(track => track.stop());
        }
        if (this.audioContext) {
            this.audioContext.close();
        }
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        this.isRunning = false;
        this.startBtn.disabled = false;
        this.stopBtn.disabled = true;
        this.status.innerHTML = '<p>マイクを開始してください</p>';
        this.frequencyDisplay.textContent = '-- Hz';
        this.noteDisplay.textContent = '--';
        this.tuningStatus.textContent = '--';
        this.needle.style.transform = 'translateX(0%)';
        
        // 波形をクリア
        if (this.canvas && this.canvasContext) {
            const ctx = this.canvasContext;
            ctx.fillStyle = '#f5f5f5';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
        if (this.waveformInfo) {
            this.waveformInfo.textContent = '音声を検出していません';
            this.waveformInfo.className = 'waveform-info';
        }
    }

    analyze() {
        if (!this.isRunning) return;

        this.analyser.getFloatTimeDomainData(this.dataArray);
        this.analyser.getFloatTimeDomainData(this.timeDataArray);
        this.analyser.getFloatFrequencyData(this.frequencyDataArray);
        
        // 波形を描画
        this.drawWaveform();
        
        // 音声レベルをチェック
        const audioLevel = this.getAudioLevel(this.dataArray);
        
        if (audioLevel < 0.005) {
            // 音声が検出されない場合
            this.frequencyDisplay.textContent = '-- Hz';
            this.noteDisplay.textContent = '--';
            this.tuningStatus.textContent = '音を検出できません';
            this.needle.style.transform = 'translateX(0%)';
        } else {
            // 周波数を検出（FFTベースと自己相関の両方を試す）
            let frequency = this.detectFrequencyFFT(this.frequencyDataArray, this.audioContext.sampleRate);
            
            // FFTで検出できない場合は自己相関を試す
            if (frequency <= 0) {
                frequency = this.detectFrequencyAutocorr(this.dataArray, this.audioContext.sampleRate);
            }
            
            if (frequency > 0 && frequency >= 50 && frequency <= 2000) {
                this.updateDisplay(frequency);
            } else {
                this.frequencyDisplay.textContent = '-- Hz';
                this.noteDisplay.textContent = '--';
                this.tuningStatus.textContent = '周波数を検出中...';
                this.needle.style.transform = 'translateX(0%)';
            }
        }

        this.animationId = requestAnimationFrame(() => this.analyze());
    }

    getAudioLevel(buffer) {
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
            sum += Math.abs(buffer[i]);
        }
        return sum / buffer.length;
    }

    drawWaveform() {
        if (!this.canvas || !this.canvasContext || !this.timeDataArray) return;

        const canvas = this.canvas;
        const ctx = this.canvasContext;
        const width = canvas.width;
        const height = canvas.height;

        // 背景をクリア
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(0, 0, width, height);

        // 中央線を描画
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // 音声レベルを計算
        let max = 0;
        for (let i = 0; i < this.timeDataArray.length; i++) {
            const value = Math.abs(this.timeDataArray[i]);
            max = Math.max(max, value);
        }

        // 波形を描画（パフォーマンス向上のため、データをサンプリング）
        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 2;
        ctx.beginPath();

        const sampleRate = Math.max(1, Math.floor(this.timeDataArray.length / width));
        const sliceWidth = width / (this.timeDataArray.length / sampleRate);
        let x = 0;

        for (let i = 0; i < this.timeDataArray.length; i += sampleRate) {
            const v = this.timeDataArray[i];
            const y = (v * 0.5 + 0.5) * height;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        ctx.stroke();

        // 音声レベル情報を更新
        if (max > 0.01) {
            const levelPercent = Math.min(100, (max * 100).toFixed(0));
            this.waveformInfo.textContent = `音声検出中 (レベル: ${levelPercent}%)`;
            this.waveformInfo.className = 'waveform-info active';
        } else {
            this.waveformInfo.textContent = '音声を検出していません';
            this.waveformInfo.className = 'waveform-info';
        }
    }

    detectFrequencyFFT(frequencyData, sampleRate) {
        // FFTベースの周波数検出（最も強いピークを検出）
        const nyquist = sampleRate / 2;
        const binSize = nyquist / frequencyData.length;
        
        // デシベル値をリニアスケールに変換して配列を作成
        const magnitudes = new Float32Array(frequencyData.length);
        for (let i = 0; i < frequencyData.length; i++) {
            magnitudes[i] = Math.pow(10, frequencyData[i] / 20);
        }
        
        let maxMagnitude = 0;
        let maxIndex = 0;
        
        // ギターの周波数範囲（50Hz - 2000Hz）のみをチェック
        const minBin = Math.max(0, Math.floor(50 / binSize));
        const maxBin = Math.min(Math.floor(2000 / binSize), frequencyData.length - 1);
        
        // ハーモニクス（倍音）を考慮して、基本周波数を検出
        // 低い周波数から順にチェックし、強いピークを見つける
        for (let i = minBin; i <= maxBin; i++) {
            if (magnitudes[i] > maxMagnitude) {
                // ハーモニクスでないことを確認（基本周波数の可能性が高い）
                let isFundamental = true;
                for (let harmonic = 2; harmonic <= 5; harmonic++) {
                    const harmonicBin = Math.floor(i / harmonic);
                    if (harmonicBin > 0 && magnitudes[harmonicBin] > magnitudes[i] * 0.5) {
                        isFundamental = false;
                        break;
                    }
                }
                
                if (isFundamental) {
                    maxMagnitude = magnitudes[i];
                    maxIndex = i;
                }
            }
        }
        
        // 閾値を下げて検出感度を上げる（デシベル値で-60dB以上）
        if (maxMagnitude > 0.001 && maxIndex > 0) {
            // ピーク周辺の補間でより正確な周波数を計算
            let frequency = maxIndex * binSize;
            
            // 二次補間でより正確な周波数を計算
            if (maxIndex > 0 && maxIndex < magnitudes.length - 1) {
                const y1 = magnitudes[maxIndex - 1];
                const y2 = magnitudes[maxIndex];
                const y3 = magnitudes[maxIndex + 1];
                
                if (y1 > 0 && y3 > 0) {
                    const delta = (y3 - y1) / (2 * (2 * y2 - y1 - y3));
                    frequency = (maxIndex + delta) * binSize;
                }
            }
            
            return frequency;
        }
        
        return 0;
    }

    detectFrequencyAutocorr(buffer, sampleRate) {
        // 自己相関関数を使用した周波数検出（最適化版）
        const minPeriod = Math.floor(sampleRate / 2000); // 最大2000Hzまで検出
        const maxPeriod = Math.floor(sampleRate / 50);   // 最小50Hzまで検出
        
        // パフォーマンス向上のため、サンプリング
        const step = Math.max(1, Math.floor((maxPeriod - minPeriod) / 200));
        
        let maxCorrelation = 0;
        let bestPeriod = 0;

        for (let period = minPeriod; period < maxPeriod; period += step) {
            let correlation = 0;
            const limit = Math.min(buffer.length - period, 4096); // 計算量を制限
            
            for (let i = 0; i < limit; i++) {
                correlation += buffer[i] * buffer[i + period];
            }
            correlation /= limit;
            
            if (correlation > maxCorrelation) {
                maxCorrelation = correlation;
                bestPeriod = period;
            }
        }

        // 閾値を下げて検出感度を上げる
        if (maxCorrelation > 0.05 && bestPeriod > 0) {
            return sampleRate / bestPeriod;
        }
        return 0;
    }

    updateDisplay(frequency) {
        // 周波数表示
        this.frequencyDisplay.textContent = frequency.toFixed(2) + ' Hz';

        // 最も近い音符を検出
        const note = this.frequencyToNote(frequency);
        this.noteDisplay.textContent = note.name;

        // チューニング状態を計算
        const diff = frequency - this.targetFrequency;
        const diffCents = this.frequencyToCents(frequency, this.targetFrequency);
        
        // チューニングインジケーターを更新
        this.updateTuningIndicator(diffCents);
    }

    frequencyToNote(frequency) {
        // A4 = 440Hzを基準に計算
        const A4 = 440;
        const semitones = 12 * Math.log2(frequency / A4);
        const noteIndex = Math.round(semitones) % 12;
        const octave = Math.floor(semitones / 12) + 4;
        const noteName = NOTE_NAMES[(noteIndex + 9) % 12]; // Aを基準に調整
        
        return {
            name: noteName + octave,
            cents: (semitones - Math.round(semitones)) * 100
        };
    }

    frequencyToCents(freq1, freq2) {
        return 1200 * Math.log2(freq1 / freq2);
    }

    updateTuningIndicator(cents) {
        // セント単位でのずれを計算（±50セントの範囲を表示）
        const maxCents = 50;
        const clampedCents = Math.max(-maxCents, Math.min(maxCents, cents));
        const percentage = (clampedCents / maxCents) * 100;
        
        // 針の位置を更新（-100%から100%の範囲）
        this.needle.style.transform = `translateX(${percentage}%)`;

        // チューニング状態のテキストを更新
        if (Math.abs(cents) < 5) {
            this.tuningStatus.textContent = '✓ 完璧';
            this.tuningStatus.className = 'tuning-status perfect';
        } else if (Math.abs(cents) < 20) {
            this.tuningStatus.textContent = cents > 0 ? '↑ やや高め' : '↓ やや低め';
            this.tuningStatus.className = 'tuning-status good';
        } else {
            this.tuningStatus.textContent = cents > 0 ? '↑↑ 高すぎます' : '↓↓ 低すぎます';
            this.tuningStatus.className = 'tuning-status bad';
        }
    }
}

// ページ読み込み時に初期化
document.addEventListener('DOMContentLoaded', () => {
    new GuitarTuner();
});

