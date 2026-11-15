import React, { useRef, useState, useEffect } from 'react';

interface Scene {
  start: number;
  end: number;
  title: string;
  caption: string;
}

const SCENES: Scene[] = [
  { start: 0, end: 3.2, title: 'SCENE 1: Marketplace Connection', caption: 'Customer and shopkeeper in a colorful Indian marketplace ready to make a sale.' },
  { start: 3.2, end: 7.0, title: 'SCENE 2: Aggregator Hand-Lock', caption: 'A payment aggregator appears and locks their hands. Extra fees and held funds block the payment.' },
  { start: 7.0, end: 10.2, title: 'SCENE 3: DISHA Breaks Barrier', caption: 'DISHA 8.2 arrives. A single tap dissolves the obstruction without middleman fees.' },
  { start: 10.2, end: 13.0, title: 'SCENE 4: Direct Connection', caption: 'Customer and merchant connect directly with an instant handshake.' },
  { start: 13.0, end: 16.0, title: 'SCENE 5: DISHA Emerald Glow', caption: 'Everything dims. The original DISHA logo rises with a cinematic emerald-cyan glow.' }
];

export const OurStory: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [showCaptions, setShowCaptions] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(15);
  const [activeScene, setActiveScene] = useState<Scene>(SCENES[0]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      const cur = video.currentTime;
      setCurrentTime(cur);
      const scene = SCENES.find((s) => cur >= s.start && cur < s.end) || SCENES[0];
      setActiveScene(scene);
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration || 15);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, []);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleReplay = () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = 0;
    videoRef.current.play().catch(() => {});
    setIsPlaying(true);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  return (
    <section className="section section-story" id="story">
      <div className="content-width">
        <div className="story-wrap">
          <div className="story-copy">
            <span className="section-tag inverse">OUR STORY, IN 15 SECONDS</span>
            <h2>A customer is ready to pay.<br />Why should software stand in the way?</h2>
            <p>
              Picture a busy counter. A customer reaches for their phone. You're ready to complete the sale.
              Then comes the familiar frustration: fees that chip away at your hard work, delayed notifications,
              and third-party gateways that hold onto your money.
            </p>
            <p>
              DISHA was created around a simple conviction: direct UPI was built for merchants and customers
              to connect directly. Your payment software should work for you, live on infrastructure you control,
              and never take a cut of your daily bread.
            </p>
            <div className="story-actions">
              <a className="btn btn-white" href="#how-it-works">
                See How DISHA Works <span aria-hidden="true">↗</span>
              </a>
              <a className="hero-text-link" href="#pricingCalculator">
                Calculate Your Savings <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
          <div className="story-media-column">
            <div className="story-video-container">
              <div className="story-video-frame">
                <video
                  ref={videoRef}
                  className="story-video-player"
                  src="/assets/disha-cartoon-15s.mp4"
                  poster="/assets/ramesh-kirana-morning.jpg"
                  playsInline
                  muted={isMuted}
                  autoPlay
                  loop
                  aria-label="15-second DISHA 8.2 animated cartoon showing merchant payment freedom"
                />

                <div className="story-video-controls">
                  <button
                    type="button"
                    className="video-ctrl-btn"
                    onClick={togglePlay}
                    aria-label={isPlaying ? 'Pause video' : 'Play video'}
                  >
                    {isPlaying ? '⏸' : '▶'}
                  </button>
                  <button
                    type="button"
                    className={`video-ctrl-btn ${!isMuted ? 'active' : ''}`}
                    onClick={toggleMute}
                    aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
                  >
                    {isMuted ? '🔇' : '🔊'}
                  </button>
                  <button
                    type="button"
                    className="video-ctrl-btn"
                    onClick={handleReplay}
                    aria-label="Replay video"
                  >
                    ↺
                  </button>
                  <button
                    type="button"
                    className={`video-ctrl-btn ${showCaptions ? 'active' : ''}`}
                    onClick={() => setShowCaptions(!showCaptions)}
                    aria-label={showCaptions ? 'Disable captions' : 'Enable captions'}
                  >
                    CC
                  </button>
                  <div
                    className="video-timeline"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const ratio = (e.clientX - rect.left) / rect.width;
                      if (videoRef.current) {
                        videoRef.current.currentTime = ratio * duration;
                      }
                    }}
                  >
                    <div className="video-progress-fill" style={{ width: `${progressPercent}%` }} />
                  </div>
                  <span className="video-duration-pill">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>
              </div>

              {/* Dedicated Live Scene Milestone & Subtitle Panel Below Video Player */}
              <div className="story-video-subdeck">
                <div className="video-scene-indicator">
                  <span className="scene-dot">●</span>
                  <span>{activeScene.title}</span>
                </div>

                {showCaptions && (
                  <div className="video-caption-overlay" aria-live="polite">
                    <span>{activeScene.caption}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="story-video-caption">
              <span>✦ 15-second DISHA 8.2 animated commercial · Self-paced with full audio controls</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
