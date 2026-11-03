import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CamFeed } from './CamFeed';
import { MP, type LandmarkPoint } from '../lib/posture';

const mocks = vi.hoisted(() => ({
  detect: vi.fn(),
  nextPreview: vi.fn(),
  load: vi.fn(),
}));
vi.mock('../lib/mediapipePose', () => ({ loadLiveLandmarker: mocks.load }));
vi.mock('../lib/backendClient', () => ({
  backendClient: {
    baseUrl: () => 'http://localhost',
    nextPreview: mocks.nextPreview,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  const points: LandmarkPoint[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    visibility: 0,
  }));
  [MP.leftEar, MP.leftShoulder, MP.leftHip, MP.leftKnee, MP.leftAnkle].forEach(
    (id, i) => {
      const coords = [
        [220, 180],
        [220, 280],
        [220, 480],
        [380, 480],
        [380, 700],
      ][i];
      points[id] = { x: coords[0] / 600, y: coords[1] / 900, visibility: 0.95 };
    },
  );
  mocks.detect.mockReturnValue(points);
  mocks.load.mockResolvedValue({ detect: mocks.detect });
  mocks.nextPreview
    .mockResolvedValueOnce({ blob: new Blob(['preview']), at: 1 })
    .mockImplementation(() => new Promise(() => {}));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(performance, 'now').mockReturnValue(10000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function image() {
  const img = await waitFor(() => {
    const element = screen.getByTestId('cam-feed-0').querySelector('img');
    expect(element).not.toBeNull();
    return element!;
  });
  Object.defineProperties(img, {
    naturalWidth: { value: 600 },
    naturalHeight: { value: 900 },
  });
  return img;
}

describe('sit-to-stand preview gate', () => {
  it('detects seated posture with the skeleton toggle off and changes the frame color', async () => {
    const onCheck = vi.fn();
    render(
      <CamFeed
        camCount={1}
        index={0}
        device={{ deviceId: 'camera1' } as any}
        live
        showPose={false}
        onSittingCheck={onCheck}
      />,
    );
    expect(screen.getByTestId('sitting-guide')).toHaveAttribute(
      'data-ready',
      '0',
    );
    expect(screen.getByTestId('sit-motion-placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('pose-overlay-0')).not.toBeInTheDocument();
    const img = await image();
    fireEvent.load(img);
    expect(onCheck).toHaveBeenLastCalledWith(
      expect.objectContaining({ ready: true, hipAngle: 90, kneeAngle: 90 }),
    );
    expect(screen.getByTestId('sitting-guide')).toHaveClass('ready');
    mocks.detect.mockReturnValue(null);
    vi.mocked(performance.now).mockReturnValue(11000);
    fireEvent.load(img);
    expect(onCheck).toHaveBeenLastCalledWith(
      expect.objectContaining({ ready: false }),
    );
    expect(screen.getByTestId('sitting-guide')).not.toHaveClass('ready');
  });
  it('turns the frame red and reports failure when incoming frames freeze', async () => {
    const onCheck = vi.fn();
    render(
      <CamFeed
        camCount={1}
        index={0}
        device={{ deviceId: 'camera1' } as any}
        live
        onSittingCheck={onCheck}
      />,
    );
    const img = await image();
    fireEvent.load(img);
    expect(screen.getByTestId('sitting-guide')).toHaveClass('ready');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 1600);
    await waitFor(() =>
      expect(onCheck).toHaveBeenLastCalledWith(
        expect.objectContaining({ ready: false }),
      ),
    );
    expect(screen.getByTestId('sitting-guide')).not.toHaveClass('ready');
  });
  it('reports unavailable pose detection instead of starting a recording', async () => {
    mocks.load.mockResolvedValue(null);
    const onCheck = vi.fn();
    render(<CamFeed camCount={1} index={0} live onSittingCheck={onCheck} />);
    await waitFor(() =>
      expect(onCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          ready: false,
          message: expect.stringContaining('Pose detection unavailable'),
        }),
      ),
    );
    expect(screen.getByTestId('sitting-guide')).not.toHaveClass('ready');
  });
});
