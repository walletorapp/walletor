import { motion, useReducedMotion } from "motion/react";

const orbitingBills = [
  {
    radius: 74,
    width: 64,
    opacity: 0.86,
    duration: 13,
    delay: -2,
    start: 0,
    direction: 1,
    zIndex: 4,
  },
  {
    radius: 74,
    width: 62,
    opacity: 0.76,
    duration: 13,
    delay: -2,
    start: 180,
    direction: 1,
    zIndex: 2,
  },
  {
    radius: 59,
    width: 58,
    opacity: 0.78,
    duration: 10.5,
    delay: -1.5,
    start: 90,
    direction: -1,
    zIndex: 3,
  },
  {
    radius: 59,
    width: 56,
    opacity: 0.56,
    duration: 10.5,
    delay: -1.5,
    start: 270,
    direction: -1,
    zIndex: 1,
  },
  {
    radius: 68,
    width: 54,
    opacity: 0.64,
    duration: 15,
    delay: -6,
    start: 45,
    direction: 1,
    zIndex: 2,
  },
  {
    radius: 68,
    width: 52,
    opacity: 0.5,
    duration: 15,
    delay: -6,
    start: 225,
    direction: 1,
    zIndex: 1,
  },
];

export function LiquidOrb() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative isolate mx-auto grid size-[250px] place-items-center sm:size-[270px]">
      <motion.div
        className="preview-vault-aura pointer-events-none absolute inset-[-3%] rounded-full"
        animate={
          reduceMotion
            ? undefined
            : { opacity: [0.4, 0.82, 0.48, 0.4], scale: [0.96, 1.07, 1, 0.96] }
        }
        transition={{ duration: 6.8, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        data-testid="liquid-orb-motion"
        className="preview-prize-vault absolute inset-[5%] overflow-hidden rounded-full"
        animate={
          reduceMotion
            ? undefined
            : { y: [-2, 3, -2], scale: [0.992, 1.012, 0.992] }
        }
        transition={{ duration: 6.2, repeat: Infinity, ease: "easeInOut" }}
      >
        <div className="preview-vault-depth absolute inset-0" />

        <div className="absolute inset-0 [perspective:600px]">
          <div className="preview-cash-orbit absolute inset-[15%] rounded-full" />
          <div className="preview-cash-orbit absolute inset-[25%] rounded-full opacity-60" />
          <div className="preview-cash-orbit absolute inset-[34%] rounded-full opacity-40" />

          {orbitingBills.map((bill) => {
            const orbitSize = bill.radius * 2;
            const endRotation = bill.start + bill.direction * 360;

            return (
              <motion.div
                key={`${String(bill.radius)}-${String(bill.start)}`}
                className="absolute left-1/2 top-1/2 rounded-full"
                style={{
                  width: orbitSize,
                  height: orbitSize,
                  marginLeft: -bill.radius,
                  marginTop: -bill.radius,
                  zIndex: bill.zIndex,
                }}
                initial={{ rotate: bill.start }}
                animate={
                  reduceMotion
                    ? undefined
                    : { rotate: [bill.start, endRotation] }
                }
                transition={{
                  duration: bill.duration,
                  delay: bill.delay,
                  repeat: Infinity,
                  ease: "linear",
                }}
              >
                <motion.img
                  src="/assets/walletor-cash-bill-v3.png"
                  alt=""
                  className="absolute left-1/2 top-0 max-w-none -translate-x-1/2 -translate-y-1/2 select-none object-contain drop-shadow-[0_7px_8px_rgba(0,0,0,0.42)]"
                  style={{ width: bill.width, opacity: bill.opacity }}
                  animate={
                    reduceMotion
                      ? undefined
                      : {
                          rotateY: [0, 18, 0, -18, 0],
                          scale: [0.96, 1.04, 0.96],
                        }
                  }
                  transition={{
                    duration: bill.duration / 2,
                    delay: bill.delay,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              </motion.div>
            );
          })}
        </div>

        <motion.div
          className="preview-vault-light pointer-events-none absolute inset-[-20%]"
          animate={
            reduceMotion
              ? undefined
              : { rotate: 360, opacity: [0.35, 0.72, 0.35] }
          }
          transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
        />
        <div className="preview-vault-glass pointer-events-none absolute inset-0 rounded-full" />
      </motion.div>

      <div className="preview-vault-rim pointer-events-none absolute inset-[5%] z-20 rounded-full" />

      <div className="preview-vault-value relative z-30 min-w-[142px] rounded-[24px] border border-white/12 px-4 py-3 text-center backdrop-blur-[9px]">
        <div className="flex items-center justify-center gap-1.5 text-[10px] font-semibold tracking-[0.09em] text-cyan-50/70">
          Prize pool
          <span className="size-1 rounded-full bg-cyan-200 shadow-[0_0_9px_#67e8f9]" />
        </div>
        <div className="mt-0.5 text-[46px] font-semibold tracking-[-0.065em] text-white drop-shadow-[0_0_20px_rgba(147,197,253,0.6)]">
          $0.11
        </div>
      </div>
    </div>
  );
}
