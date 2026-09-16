/** شجرة سلوك صغيرة عامة / a minimal, typed behaviour-tree kernel. */
export type NodeStatus = 'success' | 'failure' | 'running';

export interface BTNode<C> {
  readonly name: string;
  tick(ctx: C): NodeStatus;
}

export class Action<C> implements BTNode<C> {
  constructor(
    readonly name: string,
    private readonly fn: (ctx: C) => NodeStatus,
  ) {}
  tick(ctx: C): NodeStatus {
    return this.fn(ctx);
  }
}

export class Condition<C> implements BTNode<C> {
  constructor(
    readonly name: string,
    private readonly fn: (ctx: C) => boolean,
  ) {}
  tick(ctx: C): NodeStatus {
    return this.fn(ctx) ? 'success' : 'failure';
  }
}

/** ينفّذ الأبناء بالترتيب حتى ينجح أحدهم / first child that does not fail wins. */
export class Selector<C> implements BTNode<C> {
  constructor(
    readonly name: string,
    private readonly children: BTNode<C>[],
  ) {}
  tick(ctx: C): NodeStatus {
    for (const child of this.children) {
      const status = child.tick(ctx);
      if (status !== 'failure') return status;
    }
    return 'failure';
  }
}

/** ينفّذ كل الأبناء ويفشل عند أول إخفاق / all children must succeed. */
export class Sequence<C> implements BTNode<C> {
  constructor(
    readonly name: string,
    private readonly children: BTNode<C>[],
  ) {}
  tick(ctx: C): NodeStatus {
    for (const child of this.children) {
      const status = child.tick(ctx);
      if (status !== 'success') return status;
    }
    return 'success';
  }
}

export class Inverter<C> implements BTNode<C> {
  constructor(
    readonly name: string,
    private readonly child: BTNode<C>,
  ) {}
  tick(ctx: C): NodeStatus {
    const status = this.child.tick(ctx);
    if (status === 'success') return 'failure';
    if (status === 'failure') return 'success';
    return 'running';
  }
}
